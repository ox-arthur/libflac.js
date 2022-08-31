/* eslint-disable */
import * as Flac from "../dist/libflac.dev";

interface RecordingProcessorParams extends AudioWorkletProcessorConstructor {
	processorOptions: {
		maxFrameCount: number;
		numberOfChannels: number;
		sampleRate: number;
	};
}

function length(recBuffers: any[]): number {
	let recLength = 0;
	for (let i = recBuffers.length - 1; i >= 0; --i) {
		recLength += recBuffers[i].byteLength;
	}
	return recLength;
}

function mergeBuffers(channelBuffer: any[], recordingLength: number) {
	const result = new Uint8Array(recordingLength);
	let offset = 0;
	const lng = channelBuffer.length;
	for (var i = 0; i < lng; i++) {
		var buffer = channelBuffer[i];
		result.set(buffer, offset);
		offset += buffer.length;
	}
	return result;
}

function floatTo16Bit(
	inputArray: Float32Array,
	startIndex: number
): Uint16Array {
	var output = new Uint16Array(inputArray.length - startIndex);
	for (var i = 0; i < inputArray.length; i++) {
		var s = Math.max(-1, Math.min(1, inputArray[i]));
		output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return output;
}

function exportFlacData(recBuffers: any[], metaData: any): Promise<any> {
	const recLength = length(recBuffers);
	if (metaData) {
		addFLACMetaData(recBuffers, metaData);
	}
	//convert buffers into one single buffer
	return Promise.resolve(mergeBuffers(recBuffers, recLength));
}

function addFLACMetaData(chunks: Array<any>, metadata: any) {
	let offset = 4;
	let dataIndex = 0;
	let data = chunks[dataIndex]; //data chunk should contain FLAC identifier "fLaC"
	if (
		data.length < 4 ||
		String.fromCharCode.apply(null, data.subarray(offset - 4, offset)) !=
			"fLaC"
	) {
		console.error(
			"Unknown data format: cannot add additional FLAC meta data to header"
		);
		return;
	}
	//first chunk only contains the flac identifier string?
	if (data.length == 4) {
		data = chunks[dataIndex + 1]; //get 2nd data chunk which should contain STREAMINFO meta-data block (and probably more)
		offset = 0;
	}
	const view = new DataView(data.buffer);
	// block-header: STREAMINFO type, block length -> already set
	// block-content: min_blocksize, max_blocksize -> already set
	// write min_framesize as little endian uint24:
	view.setUint8(8 + offset, metadata.min_framesize >> 16); //24 bit
	view.setUint8(9 + offset, metadata.min_framesize >> 8); //24 bit
	view.setUint8(10 + offset, metadata.min_framesize); //24 bit
	// write max_framesize as little endian uint24:
	view.setUint8(11 + offset, metadata.max_framesize >> 16); //24 bit
	view.setUint8(12 + offset, metadata.max_framesize >> 8); //24 bit
	view.setUint8(13 + offset, metadata.max_framesize); //24 bit
	// block-content: sampleRate, channels, bitsPerSample -> already set
	// write total_samples as little endian uint36:
	//TODO set last 4 bits to half of the value in index 17
	view.setUint8(18 + offset, metadata.total_samples >> 24); //36 bit
	view.setUint8(19 + offset, metadata.total_samples >> 16); //36 bit
	view.setUint8(20 + offset, metadata.total_samples >> 8); //36 bit
	view.setUint8(21 + offset, metadata.total_samples); //36 bit
	writeMd5(view, 22 + offset, metadata.md5sum); //16 * 8 bit
}

function writeMd5(view: DataView, offset: number, str: string) {
	let index;
	for (let i = 0; i < str.length / 2; ++i) {
		index = i * 2;
		view.setUint8(
			i + offset,
			parseInt(str.substring(index, index + 2), 16)
		);
	}
}

class RecordingProcessor extends AudioWorkletProcessor {
	isRecording: boolean = false;
	flacBuffers: Array<unknown> = [];
	flac_encoder: number;
	flacMetadata: any;
	flacLength: number = 0;
	pcmChunk: Uint32Array;
	pcmChunkLength: number;

	constructor({
		processorOptions: { numberOfChannels, sampleRate },
	}: RecordingProcessorParams) {
		super();
		const bitsPerSample = 16;
		const compressionLevel = 5;

		this.flac_encoder = Flac.default.create_libflac_encoder(
			sampleRate,
      1,
			// numberOfChannels,
			bitsPerSample,
			compressionLevel,
			0
		);

		const status_encoder = Flac.default.init_encoder_stream(
			this.flac_encoder,
			(buffer, bytes) => this.write_callback_fn(buffer, bytes),
			(data) => this.metadata_callback_fn(data)
		);
		console.log("hello!", Flac);
		console.log("encoder", this.flac_encoder);
		console.log(`status encoder: ${status_encoder}`);

		this.pcmChunk = new Uint32Array(4096);
		this.pcmChunkLength = 0;
		// this.encoder = new Encoder(Flac.default, {
		// 	sampleRate: sampleRate, // number, e.g. 44100
		// 	channels: numberOfChannels, // number, e.g. 1 (mono), 2 (stereo), ...
		// 	bitsPerSample: bitsPerSample, // number, e.g. 8 or 16 or 24
		// 	compression: compressionLevel, // number, value between [0, 8] from low to high compression
		// 	verify: true, // boolean (OPTIONAL)
		// 	isOgg: false, // boolean (OPTIONAL), if encoded FLAC should be wrapped in OGG container
		// });
		// console.log(this.encoder);

		this.port.onmessage = (e) => {
			// console.log(Buffer);
			this.isRecording = false;
			console.log("e", e);
			let data: any;

			const status_encoder_finish =
				Flac.default.FLAC__stream_encoder_finish(this.flac_encoder);
			console.log("flac finish: " + status_encoder_finish); //DEBUG

			exportFlacData(this.flacBuffers, this.flacMetadata)
				.then((d) => {
					data = d;
				})
				.catch((e) => {
					console.error("Error exporting FLAC data", e);
				})
				.finally(() => {
					Flac.default.FLAC__stream_encoder_delete(this.flac_encoder);
					// clear();
					console.log("data length", data.length);
					this.port.postMessage({ cmd: "end", blobData: data });
					// INIT = false;
				});
			// console.log("samples", this.encoder.getSamples());
			// console.log("metadta", this.encoder.metadata);
			// const data = exportFlacFile(
			// 	[this.encoder.getSamples()],
			// 	this.encoder.metadata as StreamMetadata,
			// 	false
			// );
			// this.encoder.destroy();
			// this.port.postMessage('done', [data.buffer]);
			// this.port.postMessage(data.buffer);
		};
		this.isRecording = true;
	}

	write_callback_fn(buffer: any, bytes: any) {
    this.flacBuffers.push(buffer);
    // console.log('write', this.flacBuffers);
		this.flacLength += buffer.byteLength;
	}

	metadata_callback_fn(data: any) {
		this.flacMetadata = data;
    // console.log('metadata', this.flacMetadata);
	}

	static toView(buffer: Float32Array) {
		const buf_length = buffer.length;
		const buffer_i32 = new Uint32Array(buf_length);
		const view = new DataView(buffer_i32.buffer);
		const volume = 1;
		for (let i = 0; i < buf_length; i++) {
			view.setInt32(i * 4, buffer[i] * (0x7fff * volume), true);
		}
		return { buf_length, buffer_i32 };
	}

	applyChunk(buffer: Float32Array) {
		const view = new DataView(this.pcmChunk.buffer);
		const volume = 1;
		for (let i = 0; i < buffer.length; i++) {
			// view.setInt32(
			view.setUint32(
				this.pcmChunkLength + i * 4,
				buffer[i] * (0x7fff * volume),
				true
			);
		}
	}

	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>
	): boolean {
		if (this.isRecording) {
			// console.log(inputs[0].length);
			// const buf_length = audioData.length;
			// const buffer_i32 = new Uint32Array(buf_length);
			// const view = new DataView(buffer_i32.buffer);
			// const volume = 1;
			// for (let i = 0; i < buf_length; i++) {
			// 	view.setInt32(i * 4, audioData[i] * (0x7fff * volume), true);
			// }

			// console.log(this.pcmChunkLength);
/*
			// this.pcmChunkLength += inputs[0][0].byteLength;
			this.applyChunk(inputs[0][0]);
			this.pcmChunkLength += inputs[0][0].length;
			// console.log(inputs[0][0].length, inputs[0][0].byteLength);

			if (this.pcmChunkLength >= 4096) {
				console.log(
					// Flac.default.FLAC__stream_encoder_process_interleaved,
					this.flac_encoder,
					this.pcmChunk,
          this.pcmChunk.length,
          this.pcmChunkLength,
				);
				const flac_return =
					Flac.default.FLAC__stream_encoder_process_interleaved(
						this.flac_encoder,
						this.pcmChunk,
						this.pcmChunk.length / 1
					);
				if (flac_return != true) {
					console.log(
						"Error: encode_buffer_pcm_as_flac returned false. " +
							flac_return
					);
				}

				this.pcmChunk = new Uint32Array(4096);
				this.pcmChunkLength = 0;
			}*/

			const { buffer_i32 } = RecordingProcessor.toView(inputs[0][0]);
      const flac_return =
					Flac.default.FLAC__stream_encoder_process_interleaved(
						this.flac_encoder,
						buffer_i32,
						buffer_i32.length / 1
					);
				if (flac_return != true) {
					console.log(
						"Error: encode_buffer_pcm_as_flac returned false. " +
							flac_return
					);
				}
			// console.log(buffer_i32);
			// const buffer_i32 = floatTo16Bit(inputs[0][0], 0);

			// const data = wav_file_processing_convert_to32bitdata(inputs[0][0].buffer, 16) as Int32Array;
			// console.log(inputs, data);

			// console.log(data.buffer_i32);
			// console.log(this.encoder.encode(data.buffer_i32, data.buf_length / 8, true));
			// this.encoder.encode(data);
		}
		return true;
	}
}

registerProcessor("flac-worklet-processor", RecordingProcessor);

