#!/usr/bin/env node

// required for TypeORM
import 'reflect-metadata';
// NPS core process manager
import { CLIManager } from './lib/CLIManager';

let cli = new CLIManager();
cli.runCli();
