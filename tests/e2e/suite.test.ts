/* eslint-disable no-null/no-null */
/* eslint-disable @typescript-eslint/camelcase */
import fetch from 'node-fetch'
import { SDK, Language } from '../../src/generators/options'
import { validateSegmentEvent, events, exactArray } from './validation'

const SIDECAR_ADDRESS = 'http://localhost:8765'

if (!process.env.SDK || !process.env.LANGUAGE || !process.env.IS_DEVELOPMENT) {
	throw new Error(
		'You must run as: SDK=<sdk> LANGUAGE=<language> IS_DEVELOPMENT=<true|false> jest ./suite.test.ts'
	)
}

const sdk: SDK = process.env.SDK as SDK
const language: Language = process.env.LANGUAGE as Language
const isDevelopment: boolean = process.env.IS_DEVELOPMENT === 'true'

// Some clients don't support the full standard test suite, for various reasons.
// We document those reasons below and skip the associated tests in the suite.
const allFeatures = {
	SUPPORTS_DEFAULT_ANALYTICS_INSTANCE: true,
	SUPPORTS_UNIONS: true,
	SUPPORTS_RUNTIME_VALIDATION: true,
	DEFAULT_VIOLATION_HANDLER_THROWS_DURING_TESTS: true,
}
const perClientFeatures: Record<SDK, Partial<Record<Language, Partial<typeof allFeatures>>>> = {
	[SDK.WEB]: {
		// In analytics.js, we can't throw because there is no standard means
		// of determining if we are currently running tests.
		[Language.JAVASCRIPT]: {
			DEFAULT_VIOLATION_HANDLER_THROWS_DURING_TESTS: false,
		},
		[Language.TYPESCRIPT]: {
			DEFAULT_VIOLATION_HANDLER_THROWS_DURING_TESTS: false,
		},
	},
	[SDK.NODE]: {
		// The analytics-node SDK requires users to initialize an instance
		// before making any calls, unlike analytics.js/-android/-ios.
		[Language.JAVASCRIPT]: {
			SUPPORTS_DEFAULT_ANALYTICS_INSTANCE: false,
		},
		[Language.TYPESCRIPT]: {
			SUPPORTS_DEFAULT_ANALYTICS_INSTANCE: false,
		},
	},
	[SDK.IOS]: {
		// We have not yet added support for unions or run-time validation to the iOS client.
		[Language.OBJECTIVE_C]: {
			SUPPORTS_UNIONS: false,
			SUPPORTS_RUNTIME_VALIDATION: false,
			DEFAULT_VIOLATION_HANDLER_THROWS_DURING_TESTS: false,
		},
	},
}
const features = {
	...allFeatures,
	...perClientFeatures[sdk][language],
}

describe(`sdk:${sdk}`, () => {
	describe(`language:${language}`, () => {
		describe(`env:${isDevelopment ? 'development' : 'production'}`, () => {
			// Fetch all analytics calls that were fired after running the client's
			beforeAll(async () => {
				const resp = await fetch(`${SIDECAR_ADDRESS}/messages`)
				events.push(...(await resp.json()))
			})

			test('at least one event was received', () => {
				expect(events.length).toBeGreaterThan(0)
			})

			// Do a sanity check to make sure our client isn't overwriting any fields that
			// are usually set by the SDK itself.
			test('all received events are valid Segment payloads', () => {
				for (let event of events) {
					const error = validateSegmentEvent(event)
					expect(error).toBe(undefined)
				}
			})

			// For clients where a shared analytics instance (window.analytics, sharedAnalytics, etc)
			// is not available, we should throw an error on an attempted analytics call if the user
			// has not yet provided an analytics instance.
			if (!features.SUPPORTS_DEFAULT_ANALYTICS_INSTANCE)
				test('a missing analytics instance triggers an error', () => {
					expect('Analytics Instance Missing Threw Error').toHaveBeenReceived()
				})

			// You can configure an event in a Tracking Plan to not have any explicitely
			// set properties. We treat that case as allowing any properties to be passed
			// through. This test validates that passing no properties to this event produces
			// a `properties: {}` in the output payload.
			test('sends an empty event with no properties', () => {
				expect('Empty Event').toHaveBeenReceived({})
			})

			test('sends an event with every supported type (required)', () => {
				expect('Every Required Type').toHaveBeenReceived({
					'required any': 'Rick Sanchez',
					'required array': exactArray([137, 'C-137']),
					'required boolean': false,
					'required int': 97,
					'required number': 3.14,
					'required object': {},
					'required string': 'Alpha-Betrium',
					'required string with regex': 'Lawyer Morty',
				})
			})

			test('sends an event with every supported type (optional)', () => {
				expect('Every Optional Type').toHaveBeenReceived({})
			})

			test('sends an event with every supported type (nullable + required)', () => {
				expect('Every Nullable Required Type').toHaveBeenReceived({
					'required any': null,
					'required array': null,
					'required boolean': null,
					'required int': null,
					'required number': null,
					'required object': null,
					'required string': null,
					'required string with regex': null,
				})
			})

			test('sends an event with every supported type (nullable + optional)', () => {
				expect('Every Nullable Optional Type').toHaveBeenReceived({})
			})

			test('sends an event with an event name that requires sanitization', () => {
				expect('42_--terrible==\\"event\'++name~!3').toHaveBeenReceived()
			})

			test('sends an event with a property name that requires sanitization', () => {
				expect('Property Sanitized').toHaveBeenReceived({
					'0000---terrible-property-name~!3': 'what a cronenberg',
				})
			})

			test('sends events with an event name collision', () => {
				expect('Event Collided').toHaveBeenReceived()
				expect('event_collided').toHaveBeenReceived()
			})

			test('sends an event with a property name collision', () => {
				expect('Properties Collided').toHaveBeenReceived({
					'Property Collided': 'The Citadel',
					property_collided: 'Galactic Prison',
				})
			})

			test('sends events with property object name collision', () => {
				const schema = {
					universe: {
						name: 'Froopyland',
						occupants: exactArray([
							{
								name: 'Beth Smith',
							},
							{
								name: 'Thomas Lipkip',
							},
						]),
					},
				}
				expect('Property Object Name Collision #1').toHaveBeenReceived(schema)
				expect('Property Object Name Collision #2').toHaveBeenReceived(schema)
			})

			test('sends an event with arrays of objects', () => {
				expect('Simple Array Types').toHaveBeenReceived({
					any: exactArray([137, 'C-137']),
					boolean: exactArray([true, false]),
					integer: exactArray([97]),
					number: exactArray([3.14]),
					object: exactArray([
						{
							name: 'Beth Smith',
						},
					]),
					string: exactArray(['Alpha-Betrium']),
				})
			})

			test('sends an event with nested objects', () => {
				expect('Nested Objects').toHaveBeenReceived({
					garage: {
						tunnel: {
							'subterranean lab': {
								"jerry's memories": exactArray([]),
								"morty's memories": exactArray([]),
								"summer's contingency plan": 'Oh, man, it’s a scenario four.',
							},
						},
					},
				})
			})

			test('sends an event with nested arrays', () => {
				expect('Nested Arrays').toHaveBeenReceived({
					universeCharacters: exactArray([
						exactArray([
							{
								name: 'Morty Smith',
							},
							{
								name: 'Rick Sanchez',
							},
						]),
						exactArray([
							{
								name: 'Cronenberg Morty',
							},
							{
								name: 'Cronenberg Rick',
							},
						]),
					]),
				})
			})

			if (features.SUPPORTS_UNIONS) {
				test('sends an event with unions', () => {
					expect('Union Type').toHaveBeenReceivedMultipleTimes([
						{
							universe_name: 'C-137',
						},
						{
							universe_name: 137,
						},
						{
							universe_name: null,
						},
					])
				})
			}

			if (features.SUPPORTS_RUNTIME_VALIDATION) {
				// In development mode, we run full JSON Schema validation on payloads and
				// surface any JSON Schema violations to a configurable handler.
				if (isDevelopment) {
					// TODO: if the default violation handler does not throw, then we can't
					// detect if it was fired. Maybe look into validating the log output?
					// Probably too much work.
					if (features.DEFAULT_VIOLATION_HANDLER_THROWS_DURING_TESTS) {
						test('the default violation handler is called upon a violation', () => {
							expect('Default Violation Handler Called').toHaveBeenReceived()
						})
					}
					test('when set, a custom violation handler is called upon a violation', () => {
						expect('Custom Violation Handler Called').toHaveBeenReceived()
					})
				} else {
					test('events with violations are fired anyway in production builds', () => {
						expect('Default Violation Handler').toHaveBeenReceived({
							'regex property': 'Not a Real Morty',
						})
						expect('Custom Violation Handler').toHaveBeenReceived({
							'regex property': 'Not a Real Morty',
						})
					})
				}
			}

			// TODO: can we add tests to validate the behavior of the default violation handler
			// outside of test mode (NODE_ENV!=test)?

			// TODO: add a test that verifies that descriptions (and long descriptions?) are handled
			// correctly in the generated output. Possibly we should just use snapshot testing?

			// TODO: Test for unknown methods in dynamic languages (so just JS for now)

			// TODO: add tests with large integers + large numbers

			// TODO: add test of supplying custom context fields

			afterAll(() => {
				// If any analytics calls are still in `events`, then they were unexpected by the
				// tests configured above. This either means that a test is missing, or there is a
				// bug in this client.
				// Note: every time we see an event for a given test, we remove it from the
				// events list s.t. we can identify if any extraneous calls were made.
				expect(events).toHaveLength(0)
			})
		})
	})
})
