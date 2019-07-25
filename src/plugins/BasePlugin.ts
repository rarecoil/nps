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
import { Ruleset, ScanTarget, WorkQueueItem } from '../lib/Declarations';
import { RedisQueue } from '../lib/RedisQueue';
import { Result } from '../entity/Result'

import * as fs from 'fs';
import { promisify } from 'util';


export class BasePlugin {

    protected RESULT_BATCH_LENGTH:number = 10;
    
    protected redis:RedisQueue = null;
    protected redisResultQueueName:string = null;
    protected redisWorkQueueName:string = null;

    constructor(config:Config, rulesets:Array<Ruleset>) {
        this.redis = new RedisQueue();
        this.redisWorkQueueName = config.get("work_queue");
        this.redisResultQueueName = config.get("result_queue");
    }

    /**
     * Scan a series of target files for vulnerabilities. It is up to each
     * individual plugin to decide what this means, and what to do.
     * 
     * @param targetFiles An array of filepaths.
     * @returns an Array of Results.
     */
    public async scan(target:ScanTarget):Promise<void> {
        throw new Error("BasePlugin::scan not implemented by this plugin!");
    }


    /**
     * Read in a file and return its contents in memory.
     * TODO: Consider chunking this above certain sizes, or returning a stream. 
     * JS is small enough that we can usually read whatever.
     * 
     * @param filePath The filepath to read in.
     */
    protected async readFile(filePath:string):Promise<string|Buffer> {
        const readFileAsync = promisify(fs.readFile);
        const existsAsync = promisify(fs.exists);
        if (await existsAsync(filePath)) {
            let fileData:string|Buffer = await readFileAsync(filePath, 'utf8');
            return fileData;
        } else {
            throw new Error(`File ${filePath} does not exist`);
        }
    }


    /**
     * Get the size of a file in bytes.
     * 
     * @param filePath the filepath to read in.
     */
    protected async getFileSize(filePath:string):Promise<number> {
        const statAsync = promisify(fs.stat);

        let stats:fs.Stats = await statAsync(filePath);
        return stats.size;
    }


    protected async emitResult(results:Array<Result>):Promise<void> {
        if (results.length === 0) return;
        let resultWorkItem:WorkQueueItem = {
            data: results
        };
        for (let i = 0, ilen = results.length; i < ilen; i++) {            
            this.redis.addWork(this.redisResultQueueName, resultWorkItem);
        }
    }

}