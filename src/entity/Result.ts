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

import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity()
export class Result {

    @PrimaryColumn()
    id:string;

    @Column()
    foundBy:string;

    @Column()
    key:string;

    @Column()
    fancyName:string;
    
    @Column()
    tarballName:string;

    @Index()
    @Column()
    packageName:string;

    @Index()
    @Column()
    packageVersion:string;

    @Column()
    filePath:string;
    
    @Column({ nullable: true })
    fileExcerpt?:string;

    @Column({ nullable: true })
    lineNumber?:number;


    // moderation / workflow
    @Column({ default: false })
    ignore?:boolean;

    @Column({ default: false })
    falsePositive?:boolean;
}