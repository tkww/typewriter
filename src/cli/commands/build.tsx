import React, { useState, useEffect } from 'react'
import { Box, Text, Color } from 'ink'
import Link from 'ink-link'
import Spinner from 'ink-spinner'
import {
	getToken,
	resolveRelativePath,
	Config,
	TrackingPlanConfig,
	verifyDirectoryExists,
} from '../config'
import { JSONSchema7 } from 'json-schema'
import * as fs from 'fs'
import { promisify } from 'util'
import {
	fetchTrackingPlan,
	loadTrackingPlan,
	writeTrackingPlan,
	TRACKING_PLAN_FILENAME,
	computeDelta,
} from '../api'
import { gen, RawTrackingPlan } from '../../generators/gen'
import { SEGMENT_AUTOGENERATED_FILE_WARNING } from '../../templates'
import { join } from 'path'
import * as childProcess from 'child_process'
import { version } from '../../../package.json'
import { StandardProps } from '../index'

const readFile = promisify(fs.readFile)
const readdir = promisify(fs.readdir)
const writeFile = promisify(fs.writeFile)
const unlink = promisify(fs.unlink)
const exec = promisify(childProcess.exec)

interface Props extends StandardProps {
	/** Whether or not to generate a production client. Defaults to false. */
	production: boolean
	/** Whether or not to update the local `plan.json` with the latest Tracking Plan. Defaults to true. */
	update: boolean
}

export const Build: React.FC<Props> = props => {
	const [generatorState, setGeneratorState] = useState(getInitialState(props.config!))

	useEffect(() => {
		;(async () => {
			// TODO: multiple tracking plans
			// TODO: replace this generator with split-up components, similar to Init.
			const progress = run(props.configPath, props.config!, props.config!.trackingPlans[0], {
				production: props.production,
				update: props.update,
			})

			for await (const step of progress) {
				// Note: we copy the state here s.t. React can identify that it needs to re-render.
				setGeneratorState({ ...step })
			}
		})()
	}, [])

	return (
		<Box marginBottom={1} marginTop={1} flexDirection="column">
			{Object.entries(generatorState.steps).map(([k, step]) => {
				return <Step key={k} step={step} stepName={k} />
			})}
		</Box>
	)
}

interface StepProps {
	stepName: string
	step: StepState
}

const Step: React.FC<StepProps> = ({ stepName, step }) => {
	const stepDescriptions: Record<string, string> = {
		clearFiles: 'Removing generated files',
		loadPlan: 'Loading Tracking Plan',
		generateClient: 'Generating Typewriter client',
		afterScript: 'Cleaning up',
	}

	if (step.skipping) {
		return null
	}

	return (
		<Box flexDirection="column">
			{/* Print the description and running state of this step. */}
			<Color white>
				<Box width={3} justifyContent="center">
					{step.running ? <Spinner type="dots" /> : step.done ? <Color green> ✔</Color> : ''}
				</Box>
				<Box marginLeft={1} width={70}>
					{stepDescriptions[stepName]}
				</Box>
			</Color>
			{/* Print any notes/warnings on this step. */}
			{step.notes.map(note => (
				<Color
					grey={!note.type || note.type === 'note'}
					yellow={note.type === 'warning'}
					key={note.key || String(note.text)}
				>
					<Box marginLeft={4}>{note.type === 'warning' ? '⚠' : '↪'}</Box>
					<Box marginLeft={2} width={70} textWrap="wrap">
						{note.text}
					</Box>
				</Color>
			))}
		</Box>
	)
}

interface GeneratorState {
	steps: {
		loadPlan: StepState
		clearFiles: StepState
		generateClient: StepState
		afterScript: StepState
	}
}

interface StepState {
	running: boolean
	done: boolean
	skipping: boolean
	notes: {
		// Default: note
		type?: 'warning' | 'note'
		// Supply a key if text is a JSX.Element
		key?: string
		text: string | JSX.Element
	}[]
}

function getInitialState(config: Config): GeneratorState {
	return {
		steps: {
			loadPlan: {
				running: false,
				done: false,
				skipping: false,
				notes: [],
			},
			clearFiles: {
				running: false,
				done: false,
				skipping: false,
				notes: [],
			},
			generateClient: {
				running: false,
				done: false,
				skipping: false,
				notes: [],
			},
			afterScript: {
				running: false,
				done: false,
				skipping: !config.scripts || !config.scripts.after,
				notes: [],
			},
		},
	}
}

async function* run(
	configPath: string | undefined,
	config: Config,
	trackingPlanConfig: TrackingPlanConfig,
	genOptions: { production: boolean; update: boolean }
) {
	const state = getInitialState(config)

	// Step 1: Load a Tracking Plan, either from the API or from the `plan.json` file.
	let step = state.steps.loadPlan
	step.running = true
	yield state
	const previousSegmentTrackingPlan = await loadTrackingPlan(configPath, trackingPlanConfig)
	if (genOptions.update) {
		step.notes.push({
			text: 'Pulling most recent version from Segment',
		})
		yield state
		// TODO: support fine-grained event updates, by event name and by label.
		// For now, we will just support updating the full tracking plan.
		const token = await getToken(config)
		if (!token) {
			step.notes.push({
				type: 'warning',
				key: 'empty-token',
				text: (
					<Text>
						Unable to find a {''}
						<Link url="https://segment.com/docs/protocols/typewriter/#api-token-configuration">
							Segment API token
						</Link>
						, using cache instead
					</Text>
				),
			})
		} else {
			try {
				const trackingPlan = await fetchTrackingPlan({
					id: trackingPlanConfig.id,
					workspaceSlug: trackingPlanConfig.workspaceSlug,
					token,
				})

				await writeTrackingPlan(configPath, trackingPlan, trackingPlanConfig)
			} catch (err) {
				// TODO: more reliable network connection detection
				step.notes.push({
					type: 'warning',
					text: 'API request failed, using cache',
				})
				yield state
			}
		}
	} else {
		step.notes.push({
			text: `Loading from ${trackingPlanConfig.path + '/' + TRACKING_PLAN_FILENAME}`,
		})
		yield state
	}

	const loadedTrackingPlan = await loadTrackingPlan(configPath, trackingPlanConfig)
	step.notes.push({
		key: 'which-tracking-plan',
		text: (
			<Text>
				Using {''}
				<Link
					url={`https://app.segment.com/${
						trackingPlanConfig.workspaceSlug
					}/protocols/tracking-plans/${trackingPlanConfig.id}`}
				>
					{loadedTrackingPlan.display_name}
				</Link>
			</Text>
		),
	})
	yield state

	if (genOptions.update) {
		const deltas = computeDelta(previousSegmentTrackingPlan, loadedTrackingPlan)
		step.notes.push({
			key: 'changes',
			text:
				deltas.added === 0 && deltas.modified === 0 && deltas.removed === 0 ? (
					'No changes found'
				) : (
					<Text>
						<Color grey={deltas.added === 0} green={deltas.added > 0}>
							{deltas.added} added
						</Color>
						,{' '}
						<Color grey={deltas.modified === 0} yellow={deltas.modified > 0}>
							{deltas.modified} modified
						</Color>
						,{' '}
						<Color grey={deltas.removed === 0} red={deltas.removed > 0}>
							{deltas.removed} removed
						</Color>
					</Text>
				),
		})
		yield state
	}

	const trackingPlan: RawTrackingPlan = {
		trackCalls: loadedTrackingPlan.rules.events
			// Typewriter doesn't yet support event versioning. For now, we just choose the most recent version.
			.filter(e =>
				loadedTrackingPlan.rules.events.every(e2 => e.name !== e2.name || e.version >= e2.version)
			)
			.map<JSONSchema7>(e => ({
				...e.rules,
				title: e.name,
				description: e.description,
			})),
	}
	step.running = false
	step.done = true
	yield state

	// Step 2. Remove any previously generated files from the configured path.
	// We identify which files to clear using the `SEGMENT_AUTOGENERATED_FILE_WARNING` at the
	// top of every file.
	step = state.steps.clearFiles
	step.running = true
	yield state
	const path = resolveRelativePath(configPath, trackingPlanConfig.path)
	await verifyDirectoryExists(path)
	await clearFolder(path)
	step.running = false
	step.done = true
	yield state

	// Step 3: Generate the client and write it to the user's file system.
	step = state.steps.generateClient
	step.running = true
	step.notes.push({
		text: `Building for ${genOptions.production ? 'production' : 'development'}`,
	})
	step.notes.push({
		text: `Writing to ${trackingPlanConfig.path}`,
	})
	yield state
	const files = await gen(trackingPlan, {
		client: config.client,
		typewriterVersion: version,
		isDevelopment: !genOptions.production,
	})
	for (var file of files) {
		const path = resolveRelativePath(configPath, trackingPlanConfig.path, file.path)
		await verifyDirectoryExists(path, 'file')
		await writeFile(path, file.contents, {
			encoding: 'utf-8',
		})
	}
	step.running = false
	step.done = true
	yield state

	// Step 4: Optionally run the user's scripts.after script, if one was supplied.
	step = state.steps.afterScript
	if (!step.skipping) {
		step.running = true
		yield state
		if (config.scripts && config.scripts.after) {
			step.notes.push({
				text: config.scripts.after,
			})
			yield state
			await exec(config.scripts.after).catch(err => {
				step.notes.push({
					type: 'warning',
					text: String(err),
				})
			})
		}
		step.running = false
		step.done = true
		yield state
	}
}

// clearFolder removes all typewriter-generated files from the specified folder
// excluding plan.json.
// It uses a simple heuristic to avoid accidentally clobbering a user's files --
// it only clears files with the "this file was autogenerated by Typewriter" warning.
// Therefore, all generators need to output that warning in a comment in the first few
// lines of every generated file.
async function clearFolder(path: string): Promise<void> {
	const fileNames = await readdir(path, 'utf-8')
	for (let fileName of fileNames) {
		const fullPath = join(path, fileName)
		try {
			const contents = await readFile(fullPath, 'utf-8')
			if (contents.includes(SEGMENT_AUTOGENERATED_FILE_WARNING)) {
				await unlink(fullPath)
			}
		} catch (err) {
			// Note: none of our generators produce folders, but if we ever do, then we'll need to
			// update this logic to handle recursively traversing directores.
			// In the mean time, protect against
			if (err.code !== 'EISDIR') {
				await clearFolder(fullPath)
			}
		}
	}
}
