import path from 'path';
import chalk from 'chalk';

const endsWith = (str: string, suffix: string) => str.slice(-suffix.length) === suffix;

export function lpad(str: string | number, count: number, fill = ' '): string {
    str = '' + str;
    while (str.length < count) {
        str = fill + str;
    }
    return str;
}

// Convert a `date` into a syslog style "Nov 6 10:30:21".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateToString(date: Date | undefined): string | undefined {
    if (!date) {
        return date;
    } else if (date instanceof Date) {
        const time = [
            lpad(date.getHours(), 2, '0'),
            lpad(date.getMinutes(), 2, '0'),
            lpad(date.getSeconds(), 2, '0'),
        ].join(':');

        return [MONTHS[date.getMonth()], date.getDate(), time].join(' ');
    } else {
        return '' + date;
    }
}

// Applies one or more colors to a message, and returns the colorized message.
export function applyColors(message: string, colorList: string[]): string {
    if (message == null) {
        return message;
    }

    const c = chalk as any;
    for (const color of colorList) {
        message = c[color](message);
    }

    return message;
}

// Transforms "/src/foo/bar.coffee" to "/s/f/bar".
// Transforms "/src/foo/index.coffee" to "/s/foo/".
export function toShortFilename(
    filename: string,
    basepath: string | undefined = undefined,
    replacement = './'
) {
    let shortenIndex;
    if (basepath) {
        if (typeof basepath === 'string' && !endsWith(basepath, path.sep)) {
            basepath += path.sep;
        }
        filename = filename.replace(basepath, replacement);
    }

    const parts = filename.split(path.sep);

    let file = parts[parts.length - 1];
    const ext = path.extname(file);
    file = path.basename(file, ext);

    if (file === 'index') {
        shortenIndex = parts.length - 3;
        file = '';
    } else {
        shortenIndex = parts.length - 2;
    }

    // Strip the extension
    parts[parts.length - 1] = file;
    for (let index = 0; index < parts.length; index++) {
        if (index <= shortenIndex) {
            parts[index] = parts[index][0];
        }
    }

    return parts.join('/');
}

// Transforms a bunyan `src` object (a `{file, line, func}` object) into a human readable string.
export function srcToString(src: {file: string, line: number, func: string}, basepath: string | undefined = undefined, replacement = './') {
    if (src == null) {
        return '';
    }

    const file =
        (src.file != null ? toShortFilename(src.file, basepath, replacement) : '') +
        (src.line != null ? `:${src.line}` : '');

    const answer =
        src.func != null && file
            ? `${src.func} (${file})`
            : src.func != null
            ? src.func
            : file
            ? file
            : '';

    return answer;
}
