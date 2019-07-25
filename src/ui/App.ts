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

import { Configuration } from '../lib/Configuration';

import * as path from 'path';
import { default as express } from 'express';
import { default as helmet } from 'helmet';

import APIRouter from './routers/API';

const debug = require('debug')('ui:server');
const srcPath = path.resolve(path.join(__dirname, '..', '..', 'src', 'ui'));

/**
 * A tiny, Sinatra-esque UI application.
 */
export class App {

    private HTTP_HOST:string;
    private HTTP_PORT:number;
    private app:express.Application = null;

    constructor(host:string='localhost', port:number=6379) {
        this.HTTP_HOST = host;
        this.HTTP_PORT = port;
        
        this.app = express();
        this.app.use(helmet());
    }

    public run() {
        this.app.listen(this.HTTP_PORT, this.HTTP_HOST);

        // api routes
        const apiRouter = APIRouter;

        // core routes
        this.app.get('/', express.static(path.resolve(path.join(srcPath, './static'))));
        this.app.get('/heartbeat', this.getHeartbeat.bind(this));
        this.app.use('/api/v0', apiRouter);
    }


    /**
     * Get the main UI.
     * 
     * @param req Express.Request
     * @param res Express.Response
     */
    protected getHeartbeat(req:express.Request, res:express.Response) {
        this.success(res, "ok");
    }



    private success(res:express.Response, msg:any):void {
        res.json({
            success: true,
            result: msg
        });
    }

    private error(res:express.Response, msg:any):void {
        res.json({
            success: false,
            result: msg
        });
    }
}


if (require.main === module) {
    // load the app from here
    debug(`Running UI server`);
    let host = Configuration.get("ui_host") ? Configuration.get("ui_host") : "localhost";
    let port = Configuration.get("ui_port") ? parseInt(Configuration.get("ui_port")) : 6379;

    const app = new App(host, port);
    app.run();
}