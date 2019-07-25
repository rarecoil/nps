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

import { createClient, RedisClient } from 'redis';
import { Configuration } from './Configuration';
import { WorkQueueItem } from './Declarations';

import { createHash, randomBytes } from 'crypto';
import { promisify } from 'util';

const colorDebug = require('debug')('nps:lib:RedisQueue');
const debug = function(msg:any) {
    if (process.env.DEBUG) {
        colorDebug(`[pid:${process.pid}] ${msg}`);
    }
};

/**
 * RedisQueue
 * 
 * A limited asynchronous abstraction of the Redis client, to stop random
 * chattiness to the Redis server. If you're talking to Redis, use this.
 * 
 */
export class RedisQueue {

    private redis:RedisClient = null;

    private queueInboxSuffix      = "_waiting";
    private queueProcessingSuffix = "_processing";
    private queueDeadSuffix       = "_dead";
    private MAX_NUM_RETRIES       = 3;
    private WORK_TIMEOUT_SEC      = 300;

    private promisifiedBRPOP:any    = null;
    private promisifiedRPUSH:any    = null;
    private promisifiedGET:any      = null;
    private promisifiedSET:any      = null;
    private promisifiedLRANGE:any   = null;
    private promisifiedLREM:any     = null;
    private promisifiedBLPOP:any    = null;

    constructor() {
        const REDIS_URL = Configuration.get("redis_url");

        debug(`Initialising client with URI ${REDIS_URL}`);
        this.redis = createClient(REDIS_URL);

        if (Configuration.get("queue_max_retries")) {
            this.MAX_NUM_RETRIES = parseInt(Configuration.get("queue_max_retries"));
        }
        if (Configuration.get("queue_max_ttl_min")) {
            this.WORK_TIMEOUT_SEC = 1; // parseInt(Configuration.get("queue_max_ttl_min")) * 60;
        }

        this.promisifiedBRPOP   = promisify(this.redis.brpop).bind(this.redis);
        this.promisifiedRPUSH   = promisify(this.redis.rpush).bind(this.redis);
        this.promisifiedSET     = promisify(this.redis.set).bind(this.redis);
        this.promisifiedGET     = promisify(this.redis.get).bind(this.redis);
        this.promisifiedLRANGE  = promisify(this.redis.lrange).bind(this.redis);
        this.promisifiedLREM    = promisify(this.redis.lrem).bind(this.redis);
        this.promisifiedBLPOP   = promisify(this.redis.blpop).bind(this.redis);
    }

    // Work queue handling

    /**
     * Add a work item to the queue.
     * 
     * @param queueName The queue to add work to
     * @param workItem The item to add to the queue
     */
    public async addWork(queueName:string, workItem:WorkQueueItem|string):Promise<void> {
        let task:WorkQueueItem;
        if (typeof workItem === 'string') {
            task = {
                data: workItem
            }
        } else {
            task = (workItem as WorkQueueItem);
        }

        // set extra fields for work tracking
        task.id = this.getID();
        task.retries = 0;
        await this.RPushAsync(`${queueName}${this.queueInboxSuffix}`, [JSON.stringify(task)]);
    }

    /**
     * Inspects the processing queue for stuck/dead jobs, and attempts to retry
     * them. If retries have exceeded, it moves the work item to the dead queue.
     * 
     * @param queueName The queue name to inspect.
     */
    public async cleanupWork(queueName:string):Promise<void> {
        let items = await this.LRangeAsync(`${queueName}${this.queueProcessingSuffix}`, 0, -1);
        
        // our list shouldn't be long enough to make the getTime()
        // optimization here cause ttl issues
        let now = new Date().getTime();
        if (items && items.length) {
            for (let i = 0; i < items.length; i++) {
                let processingWorkItem:WorkQueueItem = JSON.parse(items[i]);
                if ((now - processingWorkItem.started) > (this.WORK_TIMEOUT_SEC * 1000)) {
                    console.error(`Work failed: ${processingWorkItem.id}, re-queuing.`);
                    await this.failWork(queueName, processingWorkItem, false);
                }
            }
        }
    }

    /**
     * Explicitly fail a job as impossible. Removes from the processing
     * queue and sets it up for retry. If failImmediate is true, immediately
     * drops it in the dead queue.
     * 
     * @param queueName The queue name
     * @param failImmediate Fail this immediately
     * @param workItem A work item you asked for that you can't process.
     */
    public async failWork(queueName:string, workItem:WorkQueueItem, failImmediate:boolean=false):Promise<void> {
        // remove this from the processing queue
        await this.LRemAsync(`${queueName}${this.queueProcessingSuffix}`, 0, JSON.stringify(workItem));
        workItem.retries++;
        workItem.started = 0;
        if (failImmediate === true || workItem.retries > this.MAX_NUM_RETRIES) {
            await this.RPushAsync(`${queueName}${this.queueDeadSuffix}`, [JSON.stringify(workItem)]);
        } else {
            // stick it back on the work queue for someone else to try it
            await this.RPushAsync(`${queueName}${this.queueInboxSuffix}`, [JSON.stringify(workItem)]);
        }
    }

    /**
     * Finish the work handled (remove from processing queue).
     * 
     * @param queueName The queue to finish from
     * @param workItem The work item to mark as complete.
     */
    public async finishWork(queueName:string, workItem:WorkQueueItem):Promise<void> {
        // take it off the processing queue and kill it (do not transfer to other queues)
        await this.LRemAsync(`${queueName}${this.queueProcessingSuffix}`, 0, JSON.stringify(workItem));
    }

    /**
     * Get work from the queue. When this happens, the queue assumes you are
     * processing the task immediately and adds the task to the processing queue.
     * 
     * @param queueName The queue to get work from
     */
    public async getWork(queueName:string):Promise<WorkQueueItem> {
        let result = await this.BLPopAsync(`${queueName}${this.queueInboxSuffix}`, 10);
        
        debug(`getWork: result: ${result}`);
        if (result === null) {
            return null;
        }
        if (result.length > 1) {
            result = result[1];
        }

        let workItem:WorkQueueItem = JSON.parse(result);
        workItem.started = new Date().getTime();
        await this.RPushAsync(`${queueName}${this.queueProcessingSuffix}`, [JSON.stringify(workItem)]);
        return workItem;
    }


    // Raw Redis methods, promisified
    public async BLPopAsync(queueName:string, ttl:number):Promise<any> {
        debug(`BLPOP ${queueName}, ${ttl}`);
        return this.promisifiedBLPOP(queueName, ttl);
    }

    public async BRPopAsync(queueName:string, ttl:number):Promise<any> {
        debug(`BRPOP ${queueName}, ${ttl}`);
        return this.promisifiedBRPOP(queueName, ttl);
    }

    public async RPushAsync(queueName:string, data:Array<string>):Promise<any> {
        debug(`RPUSH ${queueName}, [${data.length} elements]`);
        return this.promisifiedRPUSH(queueName, data);
    }

    public async LRangeAsync(queueName:string, begin:number, end:number):Promise<any> {
        debug(`LRANGE ${queueName} ${begin} ${end}`);
        return this.promisifiedLRANGE(queueName, begin, end);
    }

    public async LRemAsync(queueName:string, count:number, item:string):Promise<any> {
        debug(`LREM ${queueName} ${count} "${item}"`);
        return this.promisifiedLREM(queueName, count, item);
    }

    public async GetAsync(queueName:string, key:string):Promise<any> {
        debug(`GET ${queueName}, "${key}"`);
        return this.promisifiedGET(queueName, key);
    }

    public async SetAsync(queueName:string, key:string, value:string):Promise<any> {
        debug(`SET ${queueName}, "${key}", "${value}"`);
        return this.promisifiedSET(queueName, key, value);
    }

    /**
     * Create a unique identifier for the work item in the queue.
     * 
     * @returns A string that you can use as a unique ID.
     */
    protected getID():string {
        let randBytes = randomBytes(16);
        return createHash('sha256').update(randBytes).digest('hex');
    }

}