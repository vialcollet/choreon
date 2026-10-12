/** The ffmpeg concat demuxer list: one `file '…'` line per path, `\` as `/`, and `'` escaped as `'\''`. */
export const concatList = (files: string[]) => files.map((f) => `file '${f.split('\\').join('/').split("'").join("'\\''")}'`).join('\n');
