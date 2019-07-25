#!/usr/bin/env node
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

/**
 * addDirectory.ts
 * 
 * Adds a directory full of .tgz NPM packages (e.g. from NPM directly)
 * to the work queue used by NPS. Useful for testing.
 */

import { Configuration } from '../lib/Configuration';
import { RedisQueue } from '../lib/RedisQueue';
import { WorkQueueItem } from '../lib/Declarations';

import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const workQueueName:string = Configuration.get("work_queue");
const targetDirectory:string = process.argv[2];
const redis:RedisQueue = new RedisQueue();

async function main():Promise<void> {
    if (fs.existsSync(targetDirectory) && fs.statSync(targetDirectory).isDirectory()) {
        let files = fs.readdirSync(targetDirectory);
        for (let i = 0, ilen = files.length; i < ilen; i++) {
            let file = files[i];
            if (path.basename(file).endsWith(".tgz")) {
                console.info(`Adding ${file} to work queue…`);
                let item:WorkQueueItem = {
                    data: path.resolve(path.join(targetDirectory, file))
                }
                await redis.addWork(workQueueName, item);
            }
        }
    } else {
        console.error(`Cannot read target directory ${targetDirectory}`);
        process.exit(1);
    }
}

main().then(() => {
    process.exit(0);
});


