import { BunyanDebugStreamOptions } from '..';

const bunyan = require('bunyan');
const { expect } = require('chai');
const streamToString = require('stream-to-string');
const through2 = require('through2');
const bunyanDebugStream = require('../src/BunyanDebugStream');
const { dateToString } = require('../src/utils');

const ENTRY = {
    level: bunyan.INFO,
    msg: 'Hello World',
    name: 'proc',
    pid: 19,
    time: new Date(1534347616844),
};

function generateLogEntry(entry: any, options: BunyanDebugStreamOptions = {}) {
    const out = through2();
    const bunyanDebugStreamOptions = Object.assign(
        {
            colors: null,
            out,
        },
        options
    );

    const stream = bunyanDebugStream.create(bunyanDebugStreamOptions);
    stream.write(entry);
    stream.end();
    out.end();

    return streamToString(out);
}

describe('BunyanDebugStream', function () {
    it('should generate a log entry', function () {
        return generateLogEntry(ENTRY).then((result: string) => {
            expect(result).to.equal(`${dateToString(ENTRY.time)} proc[19] INFO:  Hello World\n`);
        });
    });

    it('should use a custom date format', function () {
        return generateLogEntry(ENTRY, { showDate: (time) => time.toISOString() }).then(
            (result: string) => {
                expect(result).to.equal(`2018-08-15T15:40:16.844Z proc[19] INFO:  Hello World\n`);
            }
        );
    });

    describe('prefixes', () => {
        const PREFIXED_ENTRY = {
            ...ENTRY,

            p1: 'a',
            p2: 'b',
        };

        const PREFIXERS = {
            prefixers: {
                p1: (x: string) => x,
                p2: (y: string) => y + y,
            },
        };

        it('should use a default prefix format', function () {
            return generateLogEntry(PREFIXED_ENTRY, PREFIXERS).then((result: string) => {
                expect(result).to.equal(
                    `${dateToString(ENTRY.time)} proc[19] INFO:  [a,bb] Hello World\n`
                );
            });
        });

        it('should allow to customize the prefix format', function () {
            return generateLogEntry(PREFIXED_ENTRY, {
                ...PREFIXERS,
                showPrefixes: (prefixes) => `{${prefixes.join('; ')}}`,
            }).then((result: string) => {
                expect(result).to.equal(
                    `${dateToString(ENTRY.time)} proc[19] INFO:  {a; bb} Hello World\n`
                );
            });
        });

        it('should allow to omit prefixes', function () {
            return generateLogEntry(PREFIXED_ENTRY, {
                ...PREFIXERS,
                showPrefixes: false,
            }).then((result: string) => {
                expect(result).to.equal(
                    `${dateToString(ENTRY.time)} proc[19] INFO:  Hello World\n`
                );
            });
        });
    });
});
