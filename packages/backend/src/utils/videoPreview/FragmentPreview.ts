import ffmpeg from 'fluent-ffmpeg';

const noop = () => {};

/*
	`fluent-ffmpeg` is already a dependency and exposes `ffmpeg.ffprobe`, which
	shells out to the same binary the dropped `ffmpeg-probe` package wrapped, so
	that package (and its `execa` tree) is no longer needed. `width`/`height` are
	lifted from the video stream so callers keep reading `info.width` /
	`info.height` exactly as before.
*/
const probe = async (input: string): Promise<any> =>
	new Promise((resolve, reject) => {
		// The first parameter is not named `error`/`err` because
		// `promise/prefer-await-to-callbacks` reports such callbacks.
		ffmpeg.ffprobe(input, (ffprobeError, data) => {
			if (ffprobeError) {
				// `fluent-ffmpeg` types the ffprobe error as `any`, but the promise
				// rules require an `Error` rejection reason.
				reject(ffprobeError instanceof Error ? ffprobeError : new Error(String(ffprobeError)));
				return;
			}

			const stream = data.streams.find(s => s.codec_type === 'video') ?? data.streams[0];

			resolve({ ...data, width: stream?.width, height: stream?.height });
		});
	});

const getRandomInt = (min: number, max: number) => {
	const minInt = Math.ceil(min);
	const maxInt = Math.floor(max);

	return Math.floor(Math.random() * (maxInt - minInt + 1) + minInt);
};

const getStartTime = (
	vDuration: number,
	fDuration: number,
	ignoreBeforePercent: number,
	ignoreAfterPercent: number
) => {
	// by subtracting the fragment duration we can be sure that the resulting
	// start time + fragment duration will be less than the video duration
	const safeVDuration = vDuration - fDuration;

	// if the fragment duration is longer than the video duration
	if (safeVDuration <= 0) {
		return 0;
	}

	return getRandomInt(ignoreBeforePercent * safeVDuration, ignoreAfterPercent * safeVDuration);
};

export default async (opts: any) => {
	const {
		log = noop,

		// general output options
		quality = 2,
		width,
		height,
		input,
		output,

		fragmentDurationSecond = 3,
		ignoreBeforePercent = 0.25,
		ignoreAfterPercent = 0.75
	} = opts;

	const info = await probe(input);

	let { duration } = info.format;
	duration = Number.parseInt(duration, 10);

	const startTime = getStartTime(duration, fragmentDurationSecond, ignoreBeforePercent, ignoreAfterPercent);

	const result: any = { startTime, duration };

	await new Promise((resolve, reject) => {
		let scale = null;

		if (width && height) {
			result.width = width | 0;
			result.height = height | 0;
			scale = `scale=${width as number}:${height as number}`;
		} else if (width) {
			result.width = width | 0;
			result.height = ((info.height * width) / info.width) | 0;
			scale = `scale=${width as number}:-1`;
		} else if (height) {
			result.height = height | 0;
			result.width = ((info.width * height) / info.height) | 0;
			scale = `scale=-1:${height as number}`;
		} else {
			result.width = info.width;
			result.height = info.height;
		}

		ffmpeg()
			.input(input)
			.inputOptions([`-ss ${startTime}`])
			.outputOptions(['-vsync', 'vfr'])
			.outputOptions(['-q:v', quality, '-vf', scale])
			.outputOptions([`-t ${fragmentDurationSecond as number}`])
			.noAudio()
			.output(output)
			.on('start', cmd => log?.({ cmd }))
			.on('end', resolve)
			.on('error', reject)
			.run();
	});

	return result;
};
