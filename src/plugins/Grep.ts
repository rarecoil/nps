/*
    NPS - The Node Package Scanner
    Copyright (C) 2019 rarecoil.

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Config } from '../lib/Configuration';
import { Ruleset, ScanTarget } from '../lib/Declarations';
import { Result } from '../entity/Result';
import { BasePlugin } from "./BasePlugin";

import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import { once } from 'events';

const isTextPath = require('is-text-path');
const debug = require('debug')('plugins:grep');
const heapdump = require('heapdump');

/**
 * Grep Plugin.
 * 
 * Pretty much what it says in its name. Searches files line-by-line for regular
 * expression-based patterns.
 */
export default class Grep extends BasePlugin {

    private rulesets:Array<Ruleset> = [];
    private rules:Array<GrepRule> = [];
    private rulesLoaded:boolean = false;
    private regexCache:RegexCache = {};

    // optimizations for length limits, file types
    // stops false-positive or duplicate findings
    private OPTIMIZATION_LENGTH_LIMIT:boolean = true;
    private MAX_EXCERPT_LENGTH:number = 128;
    private MAX_LINE_SCAN_LENGTH:number = 1024;

    // some packages contain node_modules
    private OPTIMIZATION_AVOID_NODE_MODULES:boolean = true;


    constructor (config:Config, rulesets:Array<Ruleset>) {
        super(config, rulesets);
        debug(`Grep plugin initialising`);
        this.rulesets = rulesets;
        debug(`config: ${config} \n rulesets: ${rulesets}`);
    }


    /**
     * Scan JS/TS target files for patterns.
     * 
     * @param targetFiles Target files.
     */
    public async scan(target:ScanTarget):Promise<void> {
        if (!this.rulesLoaded) {
            debug("Loading rules from rulesets");
            await this.loadRulesFromRulesets();
        }

        let targetFiles = target.targetFiles;

        debug(`Scanning target files`);
        let self = this;

        await Promise.all(
            targetFiles.map(async (targetFile) => {
                await self.scanFile(targetFile, target);
            })
        );

    }


    /**
     * "Grep" a file using the rules, line by line. Will regex match
     * for all available rulesets.
     * 
     * @param targetFile The target filepath
     * @returns array of results from matched rules.
     */
    protected async scanFile(targetFile:string, target:ScanTarget):Promise<void> {
        let results:Array<Result> = [];
        if (this.OPTIMIZATION_AVOID_NODE_MODULES === true) {
            if (targetFile.indexOf("node_modules") !== -1) {
                // instantly resolve this branch
                return;
            }
        }

        // filter our primary ruleset to one that makes more sense for this filetype
        let activeRulesForFile:Array<GrepRule> = this.getActiveRulesForFile(targetFile);
        debug(`${activeRulesForFile.length} active rules for ${path.basename(targetFile)}`);
        // fail fast if we don't scan this file
        if (activeRulesForFile.length === 0) return;
        
        debug(`Scanning ${path.basename(targetFile)}`);
        // these streams are RAM-problematic.
        // They stick around for a while even after .destroy().
        let inStream:fs.ReadStream = fs.createReadStream(targetFile);
        let rlInterface = readline.createInterface({
            input: inStream,
            terminal: false,
            crlfDelay: Infinity
        });

        // https://nodejs.org/api/readline.html#readline_example_read_file_stream_line_by_line
        let lineNo = 0;
        rlInterface.on('line', (line) => {
            // Process the line.
            let lineLength:number;
            if (this.OPTIMIZATION_LENGTH_LIMIT === true) {
                lineLength = line.length;
                if (lineLength > this.MAX_LINE_SCAN_LENGTH) {
                    // bypass really long lines (e.g. compressed files)
                    return;
                }
            }
            lineNo++;
            for (let i = 0, ilen = activeRulesForFile.length; i < ilen; i++) {
                try {
                    // match primary regex
                    let re:RegExp = this.getCachedRegex(activeRulesForFile[i].regex);
                    if (re.test(line)) {
                        // match
                        debug(`Match.`);
                        let result = new Result();
                        result.tarballName = target.tarballPath;
                        result.packageName = target.name;
                        result.packageVersion = target.version;
                        result.fancyName = activeRulesForFile[i].fancyName;
                        result.foundBy = "grep";
                        result.filePath = targetFile;
                        if (this.OPTIMIZATION_LENGTH_LIMIT === true && lineLength > this.MAX_EXCERPT_LENGTH) {
                            result.fileExcerpt = line.substr(0, this.MAX_EXCERPT_LENGTH);
                        } else {
                            // do not keep a direct reference to "line"
                            result.fileExcerpt = line.substr(0, line.length);
                        }
                        result.key = activeRulesForFile[i].id;
                        result.lineNumber = lineNo;
                        results.push(result);
                    }
                }
                catch (e) {
                    debug(`Encountered error with rule ${this.rules[i].id}`);
                }
            }
        });
        
        await once(rlInterface, 'close');
        inStream.destroy();

        if (results.length) {
            debug(`Emitting ${results.length} findings...`);
            await this.emitResult(results);
        }
    }


    /**
     * Load rules from rulesets.
     * Compiles all rules into a single array.
     */
    protected async loadRulesFromRulesets():Promise<void> {
        // take every ruleset and add the rules to the list
        let ourRulesets:Array<Ruleset> = [];

        if ("grep" in this.rulesets) {
            debug(`Found rulesets for this plugin`);
            ourRulesets = this.rulesets["grep"];
        }

        for (let i = 0; i < ourRulesets.length; i++) {
            let ruleset:Ruleset = ourRulesets[i];
            if (ruleset.rules) {
                for (let j = 0; j < ruleset.rules.length; j++) {
                    let rule:GrepRule = ruleset.rules[j];
                    debug(`Adding rule ${rule.id}`);
                    // TODO validate GrepRule against ReDoS
                    this.rules.push(rule);
                }
            }
        }
        this.rulesLoaded = true;
    }


    /**
     * Get a cached regex by string from the regex cache.
     * 
     * @param regexStr The regex string we need a real RegExp for.
     */
    protected getCachedRegex(regexStr:string):RegExp {
        if (!(regexStr in this.regexCache)) {
            this.regexCache[regexStr] = new RegExp(regexStr);
        }
        return this.regexCache[regexStr];
    }


    /**
     * Get active grep rules to use on this file, based upon its path and extension.
     * 
     * @param fileName The absolute path to the staged file.
     */
    protected getActiveRulesForFile(fileName:string):Array<GrepRule> {
        let rules:Array<GrepRule> = [];
        let tarballPath = path.dirname(fileName);
        let fileParts = path.basename(fileName).split(".");
        let fileExtension = "";
        if (fileParts.length >= 2) {
            fileExtension = fileParts[fileParts.length-1];
        }

        for (let i=0, ilen=this.rules.length; i < ilen; i++) {
            let ruleOk:boolean = true;
            if (this.rules[i].restrictExtensions && Array.isArray(this.rules[i].restrictExtensions)) {
                if (this.rules[i].restrictExtensions.indexOf(fileExtension) === -1) {
                    ruleOk = false;
                }
            }
            if (ruleOk === false) {
                return rules;
            }

            if (this.rules[i].excludeFilepaths && Array.isArray(this.rules[i].excludeFilepaths)) {
                for (let j = 0, jlen = this.rules[i].excludeFilepaths.length; j < jlen; j++) {
                    let re = this.getCachedRegex(this.rules[i].excludeFilepaths[j]);
                    if (re.test(tarballPath)) {
                        ruleOk = false;
                    }
                }
            }

            if (ruleOk === true) {
                rules.push(this.rules[i]);
            }
        }
        return rules;
    }

}

interface GrepRule {
    id:string;
    regex:string;
    fancyName:string;
    excludeFilepaths?:Array<string>;
    restrictExtensions?:Array<string>;
}

interface RegexCache {
    [key:string]: RegExp;
}