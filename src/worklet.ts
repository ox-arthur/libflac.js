/* eslint-disable */
import * as Flac from "../dist/libflac.dev";
import { exportFlacData } from "./utils/flac-utils";

interface RecordingProcessorParams extends AudioWorkletProcessorConstructor {
	processorOptions: {
		maxFrameCount: number;
		numberOfChannels: number;
		sampleRate: number;
	};
}

class RecordingProcessor extends AudioWorkletProcessor {
	isRecording: boolean = false;

	// Flac encoder buffer
	flacBuffers: Array<Uint8Array> = [];
	flacEncoder: number;
	flacMetadata: Flac.default.StreamMetadata;
	flacLength: number = 0;

	// Visualization (bars) buffer
	static VIZ_BUFFER_SIZE = 2048;
	// vizBuffer: Float32Array;
	// vizBytesWritten: number = 0;
	vizSampleSum: number = 0;
	vizSampleFrames: number = 0;
	vizPreviousAverage: number = 0;

	constructor({
		processorOptions: { numberOfChannels, sampleRate },
	}: RecordingProcessorParams) {
		super();
		const bitsPerSample = 16;
		const compressionLevel = 5;

		this.flacEncoder = Flac.default.create_libflac_encoder(
			sampleRate,
			1,
			// numberOfChannels,
			bitsPerSample,
			compressionLevel,
			0
		);

		const flacEncoderStatus = Flac.default.init_encoder_stream(
			this.flacEncoder,
			(buffer) => this.onWrite(buffer),
			(data) => this.onMetadata(data)
		);

		this.port.onmessage = (e) => {
			// console.log(Buffer);
			this.isRecording = false;
			// console.log("e", e);
			let data: Uint8Array;

			const encoderStatusFinish =
				Flac.default.FLAC__stream_encoder_finish(this.flacEncoder);
			// console.log("flac finish: " + status_encoder_finish); //DEBUG

			exportFlacData(this.flacBuffers, this.flacMetadata, false)
				.then((d) => {
					data = d;
				})
				.catch((e) => {
					console.error("Error exporting FLAC data", e);
				})
				.finally(() => {
					Flac.default.FLAC__stream_encoder_delete(this.flacEncoder);
					this.port.postMessage({ cmd: "END", data });
				});
		};
		this.isRecording = true;
	}

	onWrite(buffer: Uint8Array) {
		this.flacBuffers.push(buffer);
		this.flacLength += buffer.byteLength;
	}

	onMetadata(data?: Flac.default.StreamMetadata) {
		if (data) {
			this.flacMetadata = data;
		}
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

	// static average(arr: Float32Array): number {
	//   // console.log(arr);
	//   const sum = arr.reduce((cur, acc) => Math.abs(cur) + acc, 0);
	//   // console.log(sum /);
	// 	return Math.max(sum / arr.length, 1);
	// }

	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>
	): boolean {
		if (this.isRecording) {
			/**
			 * Send microphone data to FLAC enocder
			 */
			const { buffer_i32 } = RecordingProcessor.toView(inputs[0][0]);
			const flac_return =
				Flac.default.FLAC__stream_encoder_process_interleaved(
					this.flacEncoder,
					buffer_i32,
					buffer_i32.length / 1
				);
			if (flac_return != true) {
				console.log(
					"Error: encode_buffer_pcm_as_flac returned false. " +
						flac_return
				);
			}

			/**
			 * Update visualization buffer and dispatch if needed
			 */
			// Keep a running sum - more efficient than keeping samples in a buffer
			for (let i = 0; i < inputs[0][0].length; ++i) {
				this.vizSampleSum += Math.abs(inputs[0][0][i]);
			}
			this.vizSampleFrames += inputs[0][0].length;

			// If buffer is full, send out the bar
			if (this.vizSampleFrames >= RecordingProcessor.VIZ_BUFFER_SIZE) {
				let average = this.vizSampleSum / this.vizSampleFrames;
				if (average < this.vizPreviousAverage) {
					average = (this.vizPreviousAverage + average) * 0.5;
				}
				this.port.postMessage({
					cmd: "UPDATE_VIZ",
					data: average,
				});
				this.vizPreviousAverage = average;
				this.vizSampleSum = 0;
				this.vizSampleFrames = 0;
			}
		}
		return true;
	}
}

registerProcessor("flac-worklet-processor", RecordingProcessor);

