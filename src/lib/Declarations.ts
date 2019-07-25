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
 export interface RulesetList {
    [key: string]: Array<object>;
}

export interface Ruleset {
    [key: string]: any;
    
    updated:number;
    for_plugin:string;
    rules:Array<any>;
}

export interface ScanTarget {
    [key: string]: any;

    name:string;
    version:string;
    tarballPath:string;
    targetFiles:Array<string>;
}

export interface WorkQueueItem {
    data:any;

    id?:string;
    retries?:number;
    started?:number;
}