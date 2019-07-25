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

import { Router, Request, Response } from 'express';
import { Result } from '../../entity/Result';
import { Database } from '../lib/Database';

const APIRouter = Router();

// Root route
APIRouter.get('/', (req:Request, res:Response) => {
    res.json({msg: "ok"});
});

APIRouter.get('/stats', async (req:Request, res:Response) => {
    let conn = await Database.getDBConnection();
    let count = await conn.createQueryBuilder()
                .from(Result, "result")
                .getCount();
    res.json({totalFindings: count});
});


// Findings-related routes
APIRouter.get('/findings', async (req: Request, res:Response) => {
    // whitelist filterable parameters
    const findingFilters:Array<string> = 
        [
            "pluginName",
            "packageVersion",
            "foundBy",
            "key",
            "ignore",
            "falsePositive"
        ];

    let limit = isNaN(parseInt(req.query.limit)) ? 50 : parseInt(req.query.limit);
    let offset = isNaN(parseInt(req.query.offset)) ? 0 : parseInt(req.query.limit);
    
    let conn = await Database.getDBConnection();
    let query = conn.createQueryBuilder()
    .select("result")
    .from(Result, "result")
    .limit(limit)
    .offset(offset)
    .where("1=1"); // XXX this is depressing and I should learn how to actually use this ORM

    // only allow whitelisted query parameters, and parameterize input
    for (let i = 0; i < findingFilters.length; i++) {
        if (req.query[findingFilters[i]]) {
            let qobj:any = {};
            qobj['param_'+i] = req.query[findingFilters[i]];
            query.andWhere(`"result"."${findingFilters[i]}" = :param_${i}`, qobj);
        }
    }

    let results = await query.getMany();
    res.json({limit: limit, offset: offset, findings: results});
});

APIRouter.get('/findings/:id', async (req:Request, res:Response) => {
    let conn = await Database.getDBConnection();
    let result = await conn.createQueryBuilder()
    .select("result")
    .from(Result, "result")
    .where("result.id = :id", {id: req.params.id})
    .getOne();

    res.json(result);
});

// allow update of workflow fields
const updateFinding = async (req:Request, res:Response) => {
    let updatableFields:Array<string> = [
        "ignore", 
        "falsePositive"
    ];

    if (!req.body) {
        res.status(400).json({ msg: "Missing POST body" });
        return;
    }

    // let's get the one from the db and not trust
    // the incoming full object
    let conn = await Database.getDBConnection();
    let result = await conn.createQueryBuilder()
    .select("result")
    .from(Result, "result")
    .where("result.id = :id", {id: req.params.id})
    .getOne();

    if (result) {
        let ig:boolean = typeof (req.body.falsePositive) !== undefined ? req.body.falsePositive : result.falsePositive;
        let fp:boolean = typeof (req.body.ignore) !== undefined ? req.body.ignore: result.ignore;
        try {
            await conn.createQueryBuilder()
                .update(Result)
                .set({
                    ignore: ig,
                    falsePositive: fp
                })
                .execute();
            // don't reflect
            res.status(204);
        }
        catch(e) {
            res.status(500).json({ msg: "Database error"});
        }
    } else {
        res.status(404).json({ msg: "Record not found" });
    }
};
APIRouter.post('/findings/:id', updateFinding);
APIRouter.put('/findings/:id', updateFinding);


const markIgnore = async (req:Request, res:Response) => {
    let conn = await Database.getDBConnection();
    let result = await conn.createQueryBuilder()
    .select("result")
    .from(Result, "result")
    .where("result.id = :id", {id: req.params.id})
    .getOne();

    if (result) {
        try {
            await conn.createQueryBuilder()
                    .update(Result)
                    .set({
                        ignore: true
                    })
                    .execute();
        }
        catch(e) {
            res.status(500).json({ msg: "Database error"});
        }
        // don't reflect
        res.status(204);
    } else {
        res.status(404).json({ msg: "Record not found" });
    }
};
APIRouter.post('/findings/:id/ignore', markIgnore);
APIRouter.put('/findings/:id/ignore', markIgnore);
APIRouter.delete('/findings/:id/ignore', async (req:Request, res:Response) => {
    let conn = await Database.getDBConnection();
    let result = await conn.createQueryBuilder()
    .select("result")
    .from(Result, "result")
    .where("result.id = :id", {id: req.params.id})
    .getOne();

    if (result) {
        try {
            await conn.createQueryBuilder()
                    .update(Result)
                    .set({
                        ignore: false
                    })
                    .execute();
        }
        catch(e) {
            res.status(500).json({ msg: "Database error"});
        }
        // don't reflect
        res.status(204);
    } else {
        res.status(404).json({ msg: "Record not found" });
    }
});


const markFalsePositive = async (req:Request, res:Response) => {
    let conn = await Database.getDBConnection();
    let result = await conn.createQueryBuilder()
    .select("result")
    .from(Result, "result")
    .where("result.id = :id", {id: req.params.id})
    .getOne();

    if (result) {
        try {
            await conn.createQueryBuilder()
                    .update(Result)
                    .set({
                        falsePositive: true
                    })
                    .execute();
            res.status(204);
        }
        catch(e) {
            res.status(500).json({ msg: "Database error"});
        }
        // don't reflect
        res.status(204);
    } else {
        res.status(404).json({ msg: "Record not found" });
    }
};

APIRouter.post('/findings/:id/falsePositive', markFalsePositive);
APIRouter.put('/findings/:id/falsePositive', markFalsePositive);
APIRouter.delete('/findings/:id/falsePositive', async (req:Request, res:Response) => {
    let conn = await Database.getDBConnection();
    let result = await conn.createQueryBuilder()
    .select("result")
    .from(Result, "result")
    .where("result.id = :id", {id: req.params.id})
    .getOne();

    if (result) {
        try {
            await conn.createQueryBuilder()
                    .update(Result)
                    .set({
                        falsePositive: false
                    })
                    .execute();
            res.status(204);
        }
        catch(e) {
            res.status(500).json({ msg: "Database error"});
        }
        // don't reflect
        res.status(204);
    } else {
        res.status(404).json({ msg: "Record not found" });
    }
});


export default APIRouter;