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

import * as path from 'path';
import * as fs from 'fs';

import { Configuration } from './Configuration';
import { RulesetList, Ruleset } from './Declarations';
import { BasePlugin } from '../plugins/BasePlugin';

const colorDebug = require('debug')('nps:lib:PluginLoader');
const debug = function(msg:any) {
    if (process.env.DEBUG) {
        colorDebug(`[pid:${process.pid}] ${msg}`);
    }
};

export class PluginLoader {

    public plugins:Array<BasePlugin> = [];
    public rulesets:RulesetList = {};

    private pluginPath:string = null;
    private rulesetPath:string = null;
    private rulesetsLoaded:boolean = false;

    constructor() {
        let pluginPath:string = Configuration.get("plugin_path");
        if (pluginPath) {
            this.pluginPath = pluginPath;
        } else {
            this.pluginPath = path.resolve(path.join(__dirname, "..", "plugins"));
        }

        let rulesetPath:string = Configuration.get("ruleset_path");
        if (rulesetPath) {
            this.rulesetPath = rulesetPath;
        } else {
            this.rulesetPath = path.resolve(path.join(__dirname, '..', '..', 'src', 'rulesets'));
        }
    }

    public loadPlugins():Array<BasePlugin> {
        if (!this.rulesetsLoaded) {
            this.loadRulesets();
        }

        let pluginFilepaths:Array<string> = fs.readdirSync(this.pluginPath);
        for (let i = 0; i < pluginFilepaths.length; i++) {
            let pluginFile:string = path.basename(pluginFilepaths[i]);
            if (pluginFile.substr(-3) === ".js") {
                let klass:any = require(path.join(this.pluginPath, pluginFile));
                if (klass.default && typeof klass.default === "function") {
                    this.plugins.push(new klass.default(Configuration, this.rulesets));
                }
            }
        }
        return this.plugins;
    }

    /**
     * Load ruleset files for plugins.
     */
    public async loadRulesets():Promise<RulesetList> {
        debug(`Loading rulesets from ${this.rulesetPath}`);
        let files:Array<string> = fs.readdirSync(this.rulesetPath);
        for (let i = 0, ilen = files.length; i < ilen; i++) {
            let file = files[i];
            try {
                let fileData:string = fs.readFileSync(path.join(this.rulesetPath, file), 'utf8');
                let ruleset:Ruleset = JSON.parse(fileData);
                if (!(ruleset.for_plugin.toLowerCase() in this.rulesets)) {
                    this.rulesets[ruleset.for_plugin.toLowerCase()] = [];
                }
                debug(`Added ruleset for plugin ${ruleset.for_plugin}`);
                this.rulesets[ruleset.for_plugin.toLowerCase()] = 
                    this.rulesets[ruleset.for_plugin.toLowerCase()].concat(ruleset);
            }
            catch (e) {
                debug(`Could not parse file ${file}:${e}`);
            }
        }
        
        return this.rulesets;
    }

}