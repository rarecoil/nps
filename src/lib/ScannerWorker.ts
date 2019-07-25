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

import { Configuration } from './Configuration';
import { Stager } from './Stager';
import { ScanTarget, WorkQueueItem } from './Declarations';
import { Result } from '../entity/Result';
import { PluginLoader } from './PluginLoader';
import { RedisQueue } from './RedisQueue';

import * as fs from 'fs';
import * as util from 'util';
import * as readdir from 'recursive-readdir';
import * as path from 'path';

// after a ton of iterations, `debug` contains multiple string
// references 
const colorDebug = require('debug')('nps:lib:ScannerWorker');
const debug = function(msg:any) {
    if (process.env.DEBUG) {
        colorDebug(`[pid:${process.pid}] ${msg}`);
    }
};

const heapdump = require('heapdump');

export class ScannerWorker {

    private redis:RedisQueue = null;
    private redisWorkQueueName:string = null;
    private redisResultQueueName:string = null;
    private stager:Stager = null;

    private pluginLoader:PluginLoader = null;

    private DEBUG_SCANNER_HEAP_LIFESPAN:boolean = false;

    constructor() {
        debug(`Initialising new scanner`);
        this.redis = new RedisQueue();
        this.redisWorkQueueName = Configuration.get("work_queue");
        this.redisResultQueueName = Configuration.get("result_queue");
        this.stager = new Stager();
        this.loadPlugins();
    }

    public async work() {
        while (true) {
            let tarballPath:string = null;
            let workItem:WorkQueueItem = await this.redis.getWork(this.redisWorkQueueName);
            if (workItem) {
                await this.workAsync(workItem);
                if (this.DEBUG_SCANNER_HEAP_LIFESPAN === true) {
                    process.exit();
                }
            }
        }
    }

    public async workAsync(workItem:WorkQueueItem) {
        const self = this;
        try {
            let tarballPath = workItem.data;

            if (tarballPath !== null) {
                let begin = new Date().getTime();
                debug(`Analyzing ${path.basename(tarballPath)}`);
                // console.info(`[${process.pid}] Analysing ${path.basename(tarballPath)}`);

                if (this.DEBUG_SCANNER_HEAP_LIFESPAN) {
                    console.error("writing prestage snapshot");
                    heapdump.writeSnapshot('/tmp/fuzz-worker-' + process.pid + '-prestage.heapsnapshot');
                }

                debug(`Staging tarball`);
                // stage (extract) the tarball into the path.
                let stagedPath:string = await self.stage(tarballPath);

                // get a listing from the directory of files; we will
                // push these off to scanner plugins
                debug(`Reading files in staged path`);
                let moduleFiles:Array<string> = await readdir.default(stagedPath);
                let nameVersionTuple:Array<string> = [];
                for (let i = 0; i < moduleFiles.length; i++) {
                    if (path.basename(moduleFiles[i]) === 'package.json') {
                        nameVersionTuple = await this.getModuleInfoFromPackage(moduleFiles[i]);
                    }
                }
                if (nameVersionTuple.length < 2 || !nameVersionTuple[0] || !nameVersionTuple[1]) {
                    nameVersionTuple = this.getModuleInfoFromName(tarballPath);
                }


                if (this.DEBUG_SCANNER_HEAP_LIFESPAN) {
                    console.error("writing enumeration snapshot");
                    heapdump.writeSnapshot('/tmp/fuzz-worker-' + process.pid + '-enumerate.heapsnapshot');
                }

                let target:ScanTarget = {
                    name: nameVersionTuple[0],
                    version: nameVersionTuple[1],
                    tarballPath: tarballPath,
                    targetFiles: moduleFiles
                };

                debug(`Running scanners`);
                await Promise.all(
                    this.pluginLoader.plugins.map(async (plugin) => {
                        if (plugin.scan) {
                            return plugin.scan(target);
                        }
                    })
                );

                if (this.DEBUG_SCANNER_HEAP_LIFESPAN) {
                    console.error("writing post-promise snapshot");
                    heapdump.writeSnapshot('/tmp/fuzz-worker-' + process.pid + '-postpromise.heapsnapshot');
                }

                // unstage
                debug(`Done, unstaging module`);
                this.stager.unstage(stagedPath);

                if (this.DEBUG_SCANNER_HEAP_LIFESPAN) {
                    console.error("writing final snapshot");
                    heapdump.writeSnapshot('/tmp/fuzz-worker-' + process.pid + '-postunstage.heapsnapshot');
                }

                let end = new Date().getTime();
                debug(`Scanned ${path.basename(tarballPath)} in ${end - begin}ms`);
                this.redis.finishWork(this.redisWorkQueueName, workItem);
            }
        }
        catch (e) {
            debug(`Worker error: ${e.toString()}`);
            this.redis.failWork(this.redisWorkQueueName, workItem);
        }
    }


    /**
     * Takes results from a plugin and puts them into the result queue.
     * 
     * @param results Results from a plugin.
     */
    protected async processResults(results:Array<Result>):Promise<void> {
        debug(`Processing ${results.length} results into reporter queue.`);
        let resultMap:Array<string> = results.map((result) => { return JSON.stringify(result); });
        await this.redis.RPushAsync(this.redisResultQueueName, resultMap);
    }


    /**
     * Stage the tarball into a temporary path location.
     * 
     * @param tarballPath Path to the tarball.
     */
    protected async stage(tarballPath:string):Promise<string> {
        return this.stager.stageTarballFromPath(tarballPath);
    }


    /**
     * Load plugins from the plugin directory to the scanner.
     */
    protected loadPlugins():void {
        if (this.pluginLoader === null) {
            this.pluginLoader = new PluginLoader();
        }
        this.pluginLoader.loadPlugins();
    }

    /**
     * Get the name and the version of the NPM module being scanned.
     * 
     * @param tarballPath The tarball path.
     * @param packageJsonPath Target file to package.json file.
     */
    protected async getModuleInfoFromPackage(packageJsonPath:string=null):Promise<Array<string>> {
        const readFileAsync = util.promisify(fs.readFile);
        try {
            // use package.json as canonical source, tarballPath otherwise.
            let packageJsonStr = await readFileAsync(packageJsonPath, 'utf8');
            let jsonData = JSON.parse(packageJsonStr);
            let name = jsonData.name;
            let version = jsonData.version;
            return [name, version];
        }
        catch (e) {
            return [];
        }
    }

    protected getModuleInfoFromName(tarballPath:string):Array<string> {
        let targz_name = path.basename(tarballPath);
        let match = targz_name.match(/(?<name>[\w-.]+)-(?<version>.*)\.tgz/g);
        return [match.groups.name, match.groups.version];
    }
}