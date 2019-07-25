# nps

### Node Package Scanner? NPM Pwning System? ¯\\\_(ツ)\_/¯

> **Note**: This is **alpha-version** research software. It is not meant for your production use, and is in active development. NPS is a personal/private project first, and an open-source one second. I keep a private branch of this and port changes into NPS as they work for me. Use at your own risk until it stabilizes and this warning disappears from the README.
> Right now, I'm chasing down a memory leak that happens to scanner workers that are long-lived. There is a workaround in place, but if you're good at tracing Node memory leaks, please issue a PR here.

NPS (pronounced "nips") is a multithreaded mass NPM package vulnerability scanner. While you can use NPS to scan your single node modules, it is really meant to scan hundreds of thousands of tarballs downloaded from package registries. 

I use NPS on an [ODROID-C2](https://www.hardkernel.com/shop/odroid-c2/) which also holds a mirror of the npmjs.org registry on an external hard disk. Given it was written for SBC performance constraints, NPS scales relatively well to faster hardware. The C2 is not CPU limited with this script; it is RAM limited. With the C2 using a Seagate FireCuda as the backing disk, two scanner and one reporter workers will make it through one million packages with a basic ruleset in a little under 48 hours on the SBC. On an Epyc 7281 with about 64GB of RAM, it will go through a million packages in an hour.

Architecturally, NPS is a series of small workers that work in parallel to one another:

* **Plugins** are things that actually do scanning, and are pluggable, extendable classes. Use plugins to do static analysis, check against known bad signatures, et cetera. You can have plugins report whatever it is that you want as findings. Plugins can utilize **rulesets** similar to things like YARA, which are written in JSON.
* **Scanner** workers are processes that stage package tarballs, extract them, run plugins, and then report plugin results to a queue for reporters. 
* **Reporter** workers take findings from scanners and persist them to data stores for analysis.

Queues are stored on Redis for workers to consume. The default reporter saves raw findings to a "report" table in PostgresQL.

## Initial Configuration

See `config.json.sample` for a sample configuration JSON file. This needs to exist as `config.json` to run NPS. The default configuration is set up to run on most common 4-logical-core laptops.

#### Process Options

NPS is multithreaded and (largely) asynchronous. If you have a massive multicore system, you can up this and see what performance is best for you.

* **scanner_processes**:*number* &mdash; (Default: 3) The number of scanner (analysis) processes to run.
* **reporter_processes**:*number* &mdash; (Default: 1) The number of reporter processes to run. You probably never need more than one of these unless you have a serious multicore operation going on.


#### UI-Specific Options

NPS contains a really awful API/UI. This will get better, but it gives you some visibility into what NPS is doing for now and help you hunt for bugs.

* **enable_ui**:*boolean* &mdash; (Default: false) Whether or not to enable the NPS UI/API. If you are running headless, close this dumpster fire of an API off from the world.
* **ui_host**:*string* &mdash; (Default: 127.0.0.1) The host to bind the UI/API to. Defaults to localhost. **The API is unauthenticated. Do not rebind away from localhost unless you've made changes.**
* **ui_port**:*number* &mdash; (Default: 3000) The TCP port to bind the UI/API to.


#### Redis Options

Redis is used for work queues and intermediate data processing, including IPC between workers.

* **redis_url**:*string* &mdash; (Default: redis://localhost:6379) The Redis URI to use.
* **work_queue**:*string* &mdash; (Default: nps_tarball) The name for the queue which holds tarball file locations for NPS processing.
* **result_queue**:*string* &mdash; (Default: nps_result) The name for the queue which holds findings from scanner workers that are processed by reporter workers.
* **queue_max_retries**:*number* &mdash; (Default: 5) How many times to attempt a work queue task before declaring it dead.
* **queue_max_ttl_min**:*number* &mdash; (Default: 5) How long a queue can be considered active, in minutes. If you have a lot of complex scanners or big modules, you'll want to increase this. Note that this won't kill the work.


#### Postgres Options

Postgres is NPS's data store for findings, reporting, et cetera, basically anything persistent.

* **postgres_host**:*string* &mdash; (Default: localhost) The Postgres server hostname.
* **postgres_port**:*number* &mdash; (Default: 5432) The Postgres server port.
* **postgres_user**:*string* &mdash; (Default: postgres) The user to use when talking to Postgres.
* **postgres_password**:*string* &mdash; (Default: postgres) The password to use when talking to Postgres.
* **postgres_database**:*string* &mdash; (Default: nps) The database NPS uses. Give NPS its own database.


#### Filesystem Options

* **staging_path**:*string* &mdash; The temporary filepath used to extract modules to. Preferably, this is in RAM or on a fast disk; note you will be extracting arbitrary tarballs here. This directory must exist; NPS will not create it for you.


## Feeding NPS

NPS is a mass vulnerability scanner, not a downloader of NPM packages. It expects you to have downloaded and not extracted `.tgz` files directly from an NPM registry. There are various ways to go about this. You can create a full mirror of the NPM registry and database using something like [registry-static](https://github.com/davglass/registry-static), or you can use a dumb multithreaded flat-tarball downloader such as my own (unsupported) [npmdl](https://github.com/rarecoil/npmdl) which just downloads tarballs to a directory.

In order to get modules into the queue, NPS contains a script in `scripts/addDirectory.ts` which you can use on the command line to feed a directory full of `.tgz` files to NPS for scanning. NPS does not touch the files in this directory; it will extract whatever it is handed in its work queue to the `staging_path` specified above, and operate on that.

If you want to add work from your own script, you'll need to use `src/lib/RedisQueue.ts`. The `addWork` method will allow you to add arbitrary items to a queue.

## Writing your own rulesets

Rulesets are stored in `src/lib/rulesets`. There is no hard limit to the amount of rulesets in here, and you can have multiple rulesets for each plugin; NPS attaches them to plugins by the `for_plugin` field in the ruleset.

To see an example ruleset, check out `Grep.json`. This ruleset contains some basic rules for risky patterns that are normally found in JavaScript projects, and is a good starting point for your own rulesets. It is recommended that you do not edit this file (to avoid potential conflicts if you use the Git version) and instead write your own to extend this. That said, NPS would also be grateful for any rulesets that you do write. Feel free to contribute them back to the project.

## License

GPL 3.0.
&copy; 2019 rarecoil.
