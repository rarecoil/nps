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

export class Config {

    private configData:any; // JSON object

    constructor() {
        let path = this.getConfigurationPath();
        if (path === '') {
            throw new Error("Cannot find config file in expected paths.");
        }
        this.loadConfigurationData(path);
    }

    public get(key:string):any {
        if (this.configData[key]) {
            return this.configData[key];
        }
        return null;
    }

    public set(key:string, value:any):any {
        this.configData[key] = value;
    }

    private loadConfigurationData(path:string):any {
        let jsonData:string = fs.readFileSync(path, 'utf8');
        this.configData = JSON.parse(jsonData);
    }

    private getConfigurationPath():string {
        const PATHS = [
            path.join(__dirname, '..', '..', 'config.json'),
            '/etc/nps/config.json',
            '/etc/nps.json',
            '/usr/local/etc/nps.json'
        ];
        for (let i = 0; i < PATHS.length; i++) {
            if (fs.existsSync(PATHS[i]) && fs.lstatSync(PATHS[i]).isFile()) {
                return PATHS[i];
            }
        }
        return '';
    }

}

export const Configuration = new Config();