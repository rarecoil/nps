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
import * as crypto from 'crypto';

import * as tar from 'tar';
import * as rimraf from 'rimraf';

import { Configuration } from './Configuration';
import { promisify } from 'util';
import { ISize } from 'gzip-isize';
import { default as checkDiskSpace } from 'check-disk-space';

const colorDebug = require('debug')('nps:lib:Stager');
const debug = function(msg:any) {
    if (process.env.DEBUG) {
        colorDebug(`[pid:${process.pid}] ${msg}`);
    }
};

export class Stager {

    private stagingPath:string = null;
    private instSalt:string = null;

    constructor() {
        debug('Initialising Stager');
        this.stagingPath = Configuration.get("staging_path");
        this.instSalt = crypto.randomBytes(16).toString("base64");
        debug(`instance salt: ${this.instSalt}`);
    }

    public async stageTarballFromPath(tarballPath:string):Promise<string> {
        debug(`stageTarballFromPath: ${tarballPath}`);
        const mkdirAsync = promisify(fs.mkdir);
        const existsAsync = promisify(fs.exists);

        let exists = await existsAsync(tarballPath);
        if (!exists) {
            debug(`Cannot locate tarball at specified path!`);
            throw new Error("Cannot locate tarball at specified path");
        }

        // before we extract the tarball, let's make sure it's not huge.
        debug(`Checking available disk space before staging…`);
        let size = await ISize.get(tarballPath);
        let diskFree = await checkDiskSpace(path.dirname(this.stagingPath));
        if (size.originalSize > diskFree.free) {
            // we don't have the space to extract this module.
            debug(`Refusing to extract ${tarballPath}, not enough space`);
            throw new Error(`Cannot extract tarball ${path.basename(tarballPath)}, not enough space in staging path`);
        }
        
        let dirName = this.generateDirName(path.basename(tarballPath));
        let extractPath = path.join(this.stagingPath, dirName);
        debug(`Staging tarball to ${extractPath}`);

        // TODO check for dir existence already
        debug(`Creating ${extractPath}`);
        await mkdirAsync(extractPath);

        debug(`Extracting to ${extractPath}`);
        await tar.extract({
            file: tarballPath,
            cwd: extractPath,
            strict: true
        });
        return path.join(extractPath);
    }

    public async unstage(extractedPath:string):Promise<Error|boolean> {
        return new Promise((resolve, reject) => {
            rimraf.default(extractedPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        })
    }

    private generateDirName(path:string):string {
        let hash = crypto.createHash("sha256");
        return hash.update(new Date().getTime() + 
                            this.instSalt + 
                            path).digest('hex').toString();
    }

}