import bunyan, { Serializer } from 'bunyan';
import chalk from 'chalk';
import type { ClientRequest, ServerResponse } from 'http';
import path from 'path';
import { Writable } from 'stream';
import type { WriteStream } from 'tty';
import { formatException } from './exceptionUtils';
import { applyColors, dateToString, srcToString } from './utils';

interface Level {
    level: number;
    prefix: string;
    colors: string[];
}

interface Stringifier {
    (obj: any, options: { entry: any; useColor: boolean; debugStream: BunyanDebugStream }):
        | string
        | { consumed?: string[]; value: string; replaceMessage?: boolean }
        | null
        | undefined;
}

// A list of various properties for the different bunyan levels.
const LEVELS = (function () {
    const answer: { [level: number]: Level } = {};
    const o = (level: number, prefix: string, colors: string[]) =>
        (answer[level] = { level, prefix, colors });

    o(bunyan.TRACE, 'TRACE:', ['grey']);
    o(bunyan.DEBUG, 'DEBUG:', ['cyan']);
    o(bunyan.INFO, 'INFO: ', ['green']);
    o(bunyan.WARN, 'WARN: ', ['yellow']);
    o(bunyan.ERROR, 'ERROR:', ['red']);
    o(bunyan.FATAL, 'FATAL:', ['magenta']);

    return answer;
})();

// A list of fields to not print, either because they are boring or because we explicitly pull them
// out and format them in some special way.
const FIELDS_TO_IGNORE = ['src', 'msg', 'name', 'hostname', 'pid', 'level', 'time', 'v', 'err'];

// express-bunyan-logger adds a bunch of fields to the `req`, and we don't wnat to print them all.
const EXPRESS_BUNYAN_LOGGER_FIELDS = [
    'remote-address',
    'ip',
    'method',
    'url',
    'referer',
    'user-agent',
    'body',
    'short-body',
    'http-version',
    'response-hrtime',
    'status-code',
    'req-headers',
    'res-headers',
    'incoming',
    'req_id',
];

interface BunyanDebugStreamOptions {
    colors?: { [key: number]: string | string[] } | false | null;
    forceColor?: boolean;
    basepath?: string;
    basepathReplacement?: string;
    showProcess?: boolean;
    showDate?: boolean | ((time: Date, entry: any) => string);
    processName?: string;
    maxExceptionLines?: number | 'auto';
    stringifiers?: { [key: string]: Stringifier | null };
    prefixers?: { [key: string]: Stringifier | null };
    out?: WriteStream;
    indent?: string;
    showLoggerName?: boolean;
    showPid?: boolean;
    showLevel?: boolean;
    showMetadata?: boolean;
}

// This takes log entries from Bunyan, and pretty prints them to the console.
//
class BunyanDebugStream extends Writable {
    options: BunyanDebugStreamOptions;
    private _colors: { [key: string]: string[] };
    private _useColor: boolean;
    private _stringifiers: { [key: string]: Stringifier | null };
    private _prefixers: { [key: string]: Stringifier | null };
    private _processName: string;
    private _out: WriteStream;
    private _basepath: string;
    private _indent: string;
    private _showDate: boolean | ((time: Date, entry: any) => string);
    private _showLoggerName: boolean;
    private _showPid: boolean;
    private _showLevel: boolean;
    private _showMetadata: boolean;

    //
    // * `options.colors` is a hash where keys are Bunyan log levels (e.g. `bunyan.DEBUG`) and values
    //   are an array of colors (e.g. `['magenta', 'bold']`.)  Uses the `colors` module to apply
    //   all colors to the message before logging.  You can also set `options.colors` to `false`
    //   to disable colors.
    // * `options.forceColor` will turn color on, even if not using a TTY output.
    // * `options.basepath` is the absolute path of the root of your project.  If you're creating
    //   this `BunyanDebugStream` from a file called `app.js` in the root of your project, then
    //   this should be `__dirname`.
    // * `options.basepathReplacement` is a string to replace `options.basepath` with in filenames.
    //   Defaults to '.'.
    // * `options.showProcess` if true then will show "processName loggerName[pid]" in the output.
    //   If false (the default) then this will just be "loggerName[pid]".
    // * `options.showDate` if true, then show the date.  This assumes that `entry.time` is a `Date`
    //   object.  If false, time will not be shown.  You can also supply a `fn(time, entry)` here,
    //   which will be called to generate a date string if you want to customize the output
    //   format (or if `entry.time` is not a Date object).
    // * `options.processName` is the name of this process.  Defaults to the filename of the second
    //   argument in `process.argv` (on the assumption that you're running something like
    //   `node myApp.js`.)
    // * `options.maxExceptionLines` is the maximum number of lines to show in a stack trace.
    // * `options.stringifiers` is similar to Bunyan's serializers, but will be used to turn
    //   properties in log entries into strings.  A `null` stringifier can be used to hide a
    //   property from the logs.
    // * `options.prefixers` is similar to `options.stringifiers` but these strings will be prefixed
    //   onto the beginning of the `msg`, and wrapped in "[]".
    // * `options.out` is the stream to write data to.  Defaults to `process.stdout`.
    //
    constructor(options: BunyanDebugStreamOptions = {}) {
        super({ objectMode: true });

        this.options = options;

        // Enable colors for non-tty stdout
        if (this.options.forceColor) {
            chalk.level = 1;
        }

        // Compile color options
        this._colors = {};
        if (this.options.colors === false || this.options.colors === null) {
            // B&W for us.
            this._useColor = false;
            for (const levelValue of Object.keys(LEVELS)) {
                this._colors[levelValue] = [];
            }
        } else {
            this._useColor = true;

            // Load up the default colors
            for (const levelValue of Object.keys(LEVELS)) {
                const level = LEVELS[levelValue as any];
                this._colors[levelValue] = level.colors;
            }

            // Add in any colors from the options.
            const object = this.options.colors != null ? this.options.colors : {};
            for (const level of Object.keys(object)) {
                let c = object[level as any];
                if (typeof c === 'string') {
                    c = [c];
                }
                if (this._colors[level] != null) {
                    this._colors[level] = c;
                } else {
                    const levelNumber = (bunyan as any)[level.toUpperCase()];
                    if (this._colors[levelNumber] != null) {
                        this._colors[levelNumber] = c;
                    } else {
                        // I don't know what to do with this...
                    }
                }
            }
        }

        this._processName =
            this.options.processName ??
            (process.argv.length > 1
                ? path.basename(process.argv[1], path.extname(process.argv[1]))
                : undefined) ??
            (process.argv.length > 0
                ? path.basename(process.argv[0], path.extname(process.argv[0]))
                : undefined) ??
            '';

        this._stringifiers = {
            req: stdStringifiers.req,
            err: stdStringifiers.err,
        };
        if (this.options.stringifiers != null) {
            for (const key of Object.keys(this.options.stringifiers)) {
                const value = this.options.stringifiers[key];
                this._stringifiers[key] = value;
            }
        }

        // Initialize some defaults
        this._prefixers = this.options.prefixers || {};
        this._out = this.options.out || process.stdout;
        this._basepath = this.options.basepath != null ? this.options.basepath : process.cwd();
        this._indent = this.options.indent != null ? this.options.indent : '  ';

        this._showDate = this.options.showDate != null ? this.options.showDate : true;
        this._showLoggerName =
            this.options.showLoggerName != null ? this.options.showLoggerName : true;
        this._showPid = this.options.showPid != null ? this.options.showPid : true;
        this._showLevel = this.options.showLevel != null ? this.options.showLevel : true;
        this._showMetadata = this.options.showMetadata != null ? this.options.showMetadata : true;
    }

    // Runs a stringifier.
    // Appends any keys consumed to `consumed`.
    //
    // Returns `{value, message}`.  If the `stringifier` returns `repalceMessage = true`, then
    // `value` will be null and `message` will be the result of the stringifier.  Otherwise
    // `message` will be the `message` passed in, and `value` will be the result of the stringifier.
    //
    private _runStringifier(
        entry: any,
        key: string,
        stringifier: Stringifier | null,
        consumed: { [key: string]: boolean },
        message: string
    ) {
        consumed[key] = true;
        let value = null;
        let newMessage = message;

        try {
            if (stringifier == null) {
                // Null stringifier means we hide the value
            } else {
                const result = stringifier(entry[key], {
                    entry,
                    useColor: this._useColor,
                    debugStream: this,
                });
                if (result == null) {
                    // Hide the value
                } else if (typeof result === 'string') {
                    value = result;
                } else {
                    for (key of result.consumed != null ? result.consumed : []) {
                        consumed[key] = true;
                    }
                    if (result.value != null) {
                        if (result.replaceMessage) {
                            newMessage = result.value;
                            value = null;
                        } else {
                            ({ value } = result);
                        }
                    }
                }
            }
        } catch (err) {
            // Go back to the original message
            newMessage = message;
            value = 'Error running stringifier:\n' + (err as any).stack;
        }

        // Indent the result correctly
        if (value != null) {
            value = value.replace(/\n/g, `\n${this._indent}`);
        }

        return { message: newMessage, value };
    }

    private _entryToString(entry: any) {
        let key, value;
        if (typeof entry === 'string') {
            entry = JSON.parse(entry);
        }

        const colorsToApply = this._colors[entry.level != null ? entry.level : bunyan.INFO];

        // src is the filename/line number
        let src = srcToString(entry.src, this._basepath, this.options.basepathReplacement);
        if (src) {
            src += ': ';
        }

        let message = entry.msg;

        const consumed: { [key: string]: boolean } = {};
        for (const field of FIELDS_TO_IGNORE) {
            consumed[field] = true;
        }

        // Run our stringifiers
        const values = [];
        for (const key of Object.keys(this._stringifiers)) {
            const stringifier = this._stringifiers[key];
            if (entry[key] != null) {
                ({ message, value } = message = this._runStringifier(
                    entry,
                    key,
                    stringifier,
                    consumed,
                    message
                ));
                if (value != null) {
                    values.push(`${this._indent}${key}: ${value}`);
                }
            } else {
                consumed[key] = true;
            }
        }

        // Run our prefixers
        const prefixes: string[] = [];
        for (key in this._prefixers) {
            const prefixer = this._prefixers[key];
            if (entry[key] != null) {
                ({ message, value } = this._runStringifier(
                    entry,
                    key,
                    prefixer,
                    consumed,
                    message
                ));
                if (value != null) {
                    prefixes.push(value);
                }
            } else {
                consumed[key] = true;
            }
        }

        if (this._showMetadata) {
            // Use JSON.stringify on whatever is left
            for (key in entry) {
                // Skip fields we don't care about
                value = entry[key];
                if (consumed[key]) {
                    continue;
                }

                let valueString = JSON.stringify(value);
                if (valueString != null) {
                    // Make sure value isn't too long.
                    const cols = process.stdout.columns;
                    const start = `${this._indent}${key}: `;
                    if (cols && valueString.length + start.length >= cols) {
                        valueString = valueString.slice(0, cols - 3 - start.length) + '...';
                    }
                    values.push(`${start}${valueString}`);
                }
            }
        }

        const joinedPrefixes = prefixes.length > 0 ? `[${prefixes.join(',')}] ` : '';

        let date = undefined;
        if (this._showDate && typeof this._showDate === 'function') {
            date = `${this._showDate(entry.time, entry)} `;
        } else if (this._showDate) {
            date = `${dateToString(entry.time != null ? entry.time : new Date())} `;
        } else {
            date = '';
        }

        let processStr = '';
        if (this.options.showProcess) {
            processStr += this._processName;
        }
        if (this._showLoggerName) {
            processStr += entry.name;
        }
        if (this._showPid) {
            processStr += `[${entry.pid}]`;
        }
        if (processStr.length > 0) {
            processStr += ' ';
        }
        const levelPrefix = this._showLevel
            ? ((LEVELS[entry.level] != null ? LEVELS[entry.level].prefix : undefined) != null
                  ? LEVELS[entry.level] != null
                      ? LEVELS[entry.level].prefix
                      : undefined
                  : '      ') + ' '
            : '';

        let line = `${date}${processStr}${levelPrefix}${src}${joinedPrefixes}${applyColors(
            message,
            colorsToApply
        )}`;

        if (values.length > 0) {
            line += '\n' + values.map((v) => applyColors(v, colorsToApply)).join('\n');
        }
        return line;
    }

    _write(entry: any, _encoding: string, done: () => void) {
        this._out.write(this._entryToString(entry) + '\n');
        return done();
    }
}

// Build our custom versions of the standard Bunyan serializers.
export const serializers: { [key: string]: Serializer } = {};
for (const serializerName in bunyan.stdSerializers) {
    const serializer = bunyan.stdSerializers[serializerName];
    serializers[serializerName] = serializer;
}

serializers.req = function (req: ClientRequest) {
    const answer = bunyan.stdSerializers.req(req);
    if (answer != null) {
        if ((req as any).user != null) {
            answer.user = req != null ? (req as any).user : undefined;
        }
    }
    return answer;
};

serializers.res = function (res: ServerResponse) {
    const answer = bunyan.stdSerializers.res(res);
    if (answer != null) {
        answer.headers = res?.getHeaders ? res.getHeaders() : (res as any)._headers;
        if ((res as any).responseTime != null) {
            answer.responseTime = (res as any).responseTime;
        }
    }
    return answer;
};

export const stdStringifiers: { [key: string]: Stringifier } = {
    req(req: any, { entry, useColor }) {
        let status;
        let consumed = ['req', 'res'];
        const { res } = entry;

        if (
            entry['status-code'] != null &&
            entry['method'] != null &&
            entry['url'] != null &&
            entry['res-headers'] != null
        ) {
            // This is an entry from express-bunyan-logger.  Add all the fields to `consumed`
            // so we don't print them out.
            consumed = consumed.concat(EXPRESS_BUNYAN_LOGGER_FIELDS);
        }

        // Get the statusCode
        const statusCode =
            (res != null ? res.statusCode : undefined) != null
                ? res != null
                    ? res.statusCode
                    : undefined
                : entry['status-code'];
        if (statusCode != null) {
            status = `${statusCode}`;
            if (useColor) {
                const statusColor =
                    statusCode < 200 ? chalk.grey : statusCode < 400 ? chalk.green : chalk.red;
                status = chalk.bold(statusColor(status));
            }
        } else {
            status = '';
        }

        // Get the response time
        let responseTime = (() => {
            if ((res != null ? res.responseTime : undefined) != null) {
                return res.responseTime;
            } else if (entry.duration != null) {
                // bunyan-middleware stores response time in 'duration'
                consumed.push('duration');
                return entry.duration;
            } else if (entry['response-time'] != null) {
                // express-bunyan-logger stores response time in 'response-time'
                consumed.push('response-time');
                return entry['response-time'];
            } else {
                return null;
            }
        })();
        if (responseTime != null) {
            responseTime = `${responseTime}ms`;
        } else {
            responseTime = '';
        }

        // Get the user
        let user = '';
        if (req.user) {
            user = `${req.user.username || req.user.name || req.user}@`;
        } else if (entry.user) {
            consumed.push('user');
            user = `${entry.user.username || entry.user.name || entry.user}@`;
        }

        // Get the content length
        let contentLength: string =
            res?.headers?.['content-length'] || entry?.['res-headers']?.['content-length'];
        contentLength = contentLength != null ? `- ${contentLength} bytes` : '';

        const host = (req.headers != null ? req.headers.host : undefined) || null;
        const url = host != null ? `${host}${req.url}` : `${req.url}`;

        let fields = [req.method, user + url, status, responseTime, contentLength];
        fields = fields.filter((f) => !!f);
        const request = fields.join(' ');

        // If there's no message, then replace the message with the request
        const replaceMessage = !entry.msg || entry.msg === 'request finish'; // bunyan-middleware

        return { consumed, value: request, replaceMessage };
    },

    err(err, { useColor, debugStream }) {
        return formatException(err, {
            color: !!useColor,
            maxLines:
                (debugStream.options != null
                    ? debugStream.options.maxExceptionLines
                    : undefined) !== undefined
                    ? debugStream.options != null
                        ? debugStream.options.maxExceptionLines
                        : undefined
                    : undefined,
            basePath: (debugStream as any)._basepath,
            basePathReplacement:
                debugStream.options != null ? debugStream.options.basepathReplacement : undefined,
        });
    },
};

export function create(options: BunyanDebugStreamOptions): NodeJS.WritableStream {
    return new BunyanDebugStream(options);
};

export default create;
