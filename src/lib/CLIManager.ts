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

import cluster from 'cluster';
import * as process from 'process';

import { ScannerWorker } from './ScannerWorker';
import { ReporterWorker } from './ReporterWorker';
import { App } from '../ui/App';
import { Configuration, Config } from './Configuration';
import { RedisQueue } from './RedisQueue';

const colorDebug = require('debug')('nps:lib:CLIManager');
const debug = function(msg:any) {
    if (process.env.DEBUG) {
        colorDebug(`[pid:${process.pid}] ${msg}`);
    }
};

export class CLIManager {

    private PIDRoleMap:PIDToRoleMap = {};

    private numReporterProcesses:number = 1;
    private numScannerProcesses:number = 1;
    private enableUI:boolean = false;

    private redis:RedisQueue = null;
    private scannerWorkQueueName:string = null;
    private reporterWorkQueueName:string = null;

    constructor() {
        let configReporterProcesses:number = parseInt(Configuration.get("reporter_processes"));
        let configScannerProcesses:number = parseInt(Configuration.get("scanner_processes"));

        if (configReporterProcesses && !isNaN(configReporterProcesses)) {
            this.numReporterProcesses = configReporterProcesses;
        }
        if (configScannerProcesses && !isNaN(configScannerProcesses)) {
            this.numScannerProcesses = configScannerProcesses;
        }

        this.scannerWorkQueueName = Configuration.get("work_queue");
        this.reporterWorkQueueName = Configuration.get("result_queue");
        this.redis = new RedisQueue();

        this.enableUI = Configuration.get("enable_ui") === true;
    }


    /**
     * Run NPS from the command line.
     */
    public runCli():void {
        if (cluster.isMaster) {
            let pass:boolean = this.preflight();
            if (pass === false) {
                console.error(`Failed preflight checks.`);
                process.exit(1);
            }
            this.actAsMaster();
        } else {
            this.actAsWorker();
        }
    }


    /**
     * Act as a master process. Fork child worker processes, handle failed
     * processes, and handle cleanup of task queues if tasks are stalled.
     */
    protected actAsMaster():void {
        // create child processes for all types
        this.forkWorkerProcesses(WorkerRole.SCANNER, this.numScannerProcesses);
        this.forkWorkerProcesses(WorkerRole.REPORTER, this.numReporterProcesses);
        if (this.enableUI === true) {
            this.forkWorkerProcesses(WorkerRole.UI, 1);
        }

        // watch workers to make sure they didn't die, and restart them
        cluster.on('exit', (worker, _, signal) => {
            // we lost a worker
            console.error(`Worker ${worker.process.pid} died with signal ${signal}, respawning.`);
            // what type of worker was this?
            let role = this.PIDRoleMap[worker.process.pid];
            this.forkWorkerProcesses(role, 1);
            delete this.PIDRoleMap[worker.process.pid];
        });

        // periodically clean up the redis work queues
        let self = this;
        setTimeout(async () => {
            await self.redis.cleanupWork(self.scannerWorkQueueName);
            await self.redis.cleanupWork(self.reporterWorkQueueName);
        }, 1);
        setInterval(async () => {
            await self.redis.cleanupWork(self.scannerWorkQueueName);
            await self.redis.cleanupWork(self.reporterWorkQueueName);
            debug(`Cleaning work queues.`);
        }, 30 * 60 * 1000);
    }


    /**
     * Act as a worker node. Check process.env.NPS_WORKER_ROLE for
     * what to turn into and spawn.
     */
    protected actAsWorker():void {
        this.spawnWorkerProcess(process.env.NPS_WORKER_ROLE);
    }


    /**
     * "Fork" a number of processes as a specific role.
     * 
     * @param workerRole The role to pass when spawning child processes.
     * @param numProcesses The number of processes to "fork".
     */
    protected forkWorkerProcesses(workerRole:string, numProcesses:number=1):void {
        for (let i = 0; i < numProcesses; i++) {
            let env = process.env;
            env.NPS_WORKER_ROLE = workerRole;
            let worker = cluster.fork(env);
            this.PIDRoleMap[worker.process.pid] = env.NPS_WORKER_ROLE;
        }
    }


    /**
     * Spawn a worker process by loading the correct Worker class.
     * 
     * @param workerRole The worker role to load, from enum WorkerRole.
     */
    protected spawnWorkerProcess(workerRole:string):void {
        switch (workerRole) {
            case WorkerRole.SCANNER:
                debug(`Initialising scanner worker`);
                let scanner = new ScannerWorker();
                scanner.work();
                break;
            case WorkerRole.REPORTER:
                debug(`Initialising reporter worker`);
                let reporter = new ReporterWorker();
                reporter.work();
                break;
            case WorkerRole.UI:
                debug(`Initialising UI worker`);
                let ui = new App(
                            Configuration.get("ui_host"),
                            Configuration.get("ui_port")
                );
                ui.run();
                break;
            default:
                console.error(`Cannot spawn a worker with role ${workerRole}`);
                process.exit(1);
                break;
        }
    }

    /**
     * Preflight NPS before bootstrapping workers.
     * @returns boolean
     */
    protected preflight():boolean {
        // TODO
        return true;
    }

}

interface PIDToRoleMap {
    [key: number]: string;
}

enum WorkerRole {
    SCANNER     = 'scanner',
    REPORTER    = 'reporter',
    UI          = 'ui'
}