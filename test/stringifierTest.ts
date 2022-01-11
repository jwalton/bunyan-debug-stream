import 'mocha';
import { expect } from 'chai';
import * as bunyanDebugStream from '../src/BunyanDebugStream';

describe('Tests with stringifiers', function () {
    it('should work with a prefixer', function () {
        const stream = bunyanDebugStream.create({
            prefixers: {
                account(account: { name: string } | undefined) {
                    return account != null ? account.name : undefined;
                },
            },
            colors: false,
            showDate: false,
            showLevel: false,
            showLoggerName: false,
            showPid: false,
        });

        // Should work for an account
        expect((stream as any)._entryToString({ account: { name: 'hello' }, msg: 'world' })).to.equal(
            '[hello] world'
        );

        // Should work if the account is missing
        expect((stream as any)._entryToString({ account: null, msg: 'world' })).to.equal('world');
    });

    it('should hide fields if the prefixer returns null', function () {
        const stream = bunyanDebugStream.create({
            prefixers: {
                account(_account: any) {
                    return null;
                },
            },
            colors: false,
            showDate: false,
            showLevel: false,
            showLoggerName: false,
            showPid: false,
        });

        expect((stream as any)._entryToString({ account: { name: 'hello' }, msg: 'world' })).to.equal(
            'world'
        );
    });

    it('should hide fields for a null prefixer', function () {
        const stream = bunyanDebugStream.create({
            prefixers: {
                account: null,
            },
            colors: false,
            showDate: false,
            showLevel: false,
            showLoggerName: false,
            showPid: false,
        });

        expect((stream as any)._entryToString({ account: { name: 'hello' }, msg: 'world' })).to.equal(
            'world'
        );
    });

    describe('req stringifier', function () {
        it('should work', function () {
            const entry = {
                req: {
                    headers: {
                        host: 'foo.com',
                    },
                    method: 'GET',
                    url: '/index.html',
                    user: {
                        name: 'dave',
                    },
                },
                res: {
                    headers: {
                        'content-length': 500,
                    },
                    responseTime: 100,
                    statusCode: 404,
                },
            };

            const result = bunyanDebugStream.stdStringifiers.req(entry.req, {
                entry,
                useColor: false,
                debugStream: {} as any,
            });
            if (typeof result === 'string' || !result) {
                throw new Error('expected result to be an object');
            }

            const { consumed, value, replaceMessage } = result;
            expect(value).to.equal('GET dave@foo.com/index.html 404 100ms - 500 bytes');
            expect(consumed?.includes('req')).to.be.true;
            expect(replaceMessage, 'replaceMessage').to.be.true;
        });

        it('should hide all the variables in a bunyan-express-logger req', function () {
            const entry = {
                method: 'GET',
                'status-code': 200,
                url: '/index.html',
                'res-headers': [],
                req: {
                    headers: {
                        host: 'foo.com',
                    },
                    method: 'GET',
                    url: '/index.html',
                },
                msg: 'hello',
            };

            const result = bunyanDebugStream.stdStringifiers.req(entry.req, {
                entry,
                useColor: false,
                debugStream: {} as any,
            });
            if (typeof result === 'string' || !result) {
                throw new Error('expected result to be an object');
            }

            const { consumed, value, replaceMessage } = result;
            expect(value).to.equal('GET foo.com/index.html 200');
            expect(consumed?.includes('req')).to.be.true;
            expect(consumed?.includes('body')).to.be.true;
            expect(replaceMessage, 'replaceMessage').to.be.false;
        });
    });
});
