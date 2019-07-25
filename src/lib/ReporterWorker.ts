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
import { createConnection, Connection } from 'typeorm';
import { Result } from '../entity/Result';
import * as crypto from 'crypto';
import * as path from 'path';
import { WorkQueueItem } from './Declarations';
import { RedisQueue } from './RedisQueue';

const colorDebug = require('debug')('nps:lib:ReporterWorker');
const debug = function(msg:any) {
    if (process.env.DEBUG) {
        colorDebug(`[pid:${process.pid}] ${msg}`);
    }
};
export class ReporterWorker {

    private db:Connection = null;
    private redis:RedisQueue = null;

    private redisResultQueueName:string = null;
    private stagingPath:string = null;

    constructor() {
        debug(`Initialising reporter`);
        this.redis = new RedisQueue();
        this.redisResultQueueName = Configuration.get("result_queue");
        this.stagingPath = Configuration.get("staging_path");
    }

    /**
     * Take findings and persist them to Postgres.
     */
    public async work():Promise<void> {
        const self = this;

        this.db = await createConnection({
            type: "postgres",
            host: Configuration.get("postgres_host"),
            port: Configuration.get("postgres_port"),
            username: Configuration.get("postgres_user"),
            password: Configuration.get("postgres_password"),
            database: Configuration.get("postgres_database"),
            entities: [
                Result
            ],
            synchronize: true,
            logging: false
        });

        while (true) {
            let resultJson:string = null;
            let resultWorkItem:WorkQueueItem = await this.redis.getWork(this.redisResultQueueName);
            if (resultWorkItem) {
                let jsonData:any = resultWorkItem.data;
                if (Array.isArray(jsonData)) {
                    jsonData = jsonData[0];
                }

                let r = new Result();

                // there's no point in keeping non-unique findings
                // let's hash some unique part of the data and discard
                // "new" findings from scans
                r.id = this.generateIDFromResult(jsonData);

                r.fancyName = jsonData.fancyName;
                r.fileExcerpt = jsonData.fileExcerpt;
                r.filePath = jsonData.filePath.replace(this.stagingPath, "");
                r.key = jsonData.key;
                r.lineNumber = jsonData.lineNumber;
                r.packageName = jsonData.packageName;
                r.packageVersion = jsonData.packageVersion;
                r.tarballName = path.basename(jsonData.tarballName);
                r.foundBy = jsonData.foundBy;

                try {
                    await this.db.createQueryBuilder()
                        .insert()
                        .into(Result)
                        .values(r)
                        .onConflict(`("id") DO NOTHING`)
                        .execute();
                    debug(`Saved finding for ${r.packageName} v${r.packageVersion} from ${r.foundBy} (id: ${r.id})`);
                    this.redis.finishWork(this.redisResultQueueName, resultWorkItem);
                }
                catch(e) {
                    debug(`Error when saving: ${e}`);
                    this.redis.failWork(this.redisResultQueueName, resultWorkItem);
                }
            }
        }
    }


    protected generateIDFromResult(result:Result):string {
        let hashObject:Array<any> = [
            result.packageName, 
            result.packageVersion,
            result.foundBy,
            result.lineNumber,
            result.key
        ];
        return crypto
                .createHash('sha256')
                .update(JSON.stringify(hashObject))
                .digest('hex');
    }
}