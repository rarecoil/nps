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

import { createConnection, Connection } from 'typeorm';
import { Configuration } from '../../lib/Configuration';
import { Result } from '../../entity/Result';
import { createClient, RedisClient } from 'redis';

export class DataManager {
    protected db:Connection = null;
    protected redis:RedisClient = null;

    constructor() {}

    public async getDBConnection():Promise<Connection> {
        if (this.db === null) {
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
        }
        return this.db;
    }

    public async getRedisConnection():Promise<RedisClient> {
        if (this.redis === null) {
            const REDIS_URL = Configuration.get("redis_url");
            this.redis = createClient(REDIS_URL);
        }
        return this.redis;
    }

}

export const Database = new DataManager();