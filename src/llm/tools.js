// Function definitions given to the LLM and the whitelist used to validate
// whatever comes back. All arguments are strings/numbers — never sim references.
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'dispatch_agv_pickup',
      description: 'Send an idle AGV to a parts rack to collect one engine core and deliver it to an assembly line. Example: "Dispatch an AGV to pick a V8 core from Row 2 and take it to Line 1".',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string', enum: ['V8', 'V6', 'V12', 'electric'], description: 'Engine model to collect.' },
          row: { type: 'integer', minimum: 1, maximum: 3, description: 'Rack row number, 1 to 3. Optional.' },
          line: { type: 'string', enum: ['Line 1', 'Line 2'], description: 'Assembly line to deliver to.' },
        },
        required: ['sku', 'line'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_kpis',
      description: 'Report the current live dashboard figures: throughput, free AGVs, rack occupancy, queued orders and engines shipped.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_unit',
      description: 'Move the 3D camera to look at one object. AGVs are FL-1 to FL-6, lines are Line 1 / Line 2, racks are Row 1 to Row 3, dispatch doors are Door 4 / Door 5.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['forklift', 'line', 'rack', 'dock', 'inbound'] },
          id: { type: 'string', description: 'Unit name, e.g. FL-3, Line 1, Row 2, Door 4.' },
        },
        required: ['kind', 'id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_overview',
      description: 'Return the camera to the wide overview of the whole assembly hall and clear any selection.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_sim_speed',
      description: 'Pause, resume or change the simulation speed.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['pause', 'resume', 'set'], description: 'What to do.' },
          speed: { type: 'number', enum: [1, 2, 5, 10], description: 'Required only for action=set.' },
        },
        required: ['action'],
      },
    },
  },
]

export const SYSTEM_PROMPT = `You are the control assistant for an interactive 3D engine-assembly digital twin in the browser.
The hall has 3 parts-rack rows (Row 1, Row 2, Row 3), 2 assembly lines (Line 1, Line 2), six AGVs named FL-1 to FL-6,
three inbound doors (Door 1-3) and two dispatch doors (Door 4-5). Engine models are V8, V6, V12 and electric.

Always act by calling exactly one of the provided tools. Never invent a tool or a unit name.
When you call a tool, leave the text response empty — the app prints the tool result itself.
If the request cannot be mapped to a tool, reply briefly that you can only dispatch AGVs, report status, focus the camera, reset the view or change speed.`

const ALLOWED = new Set(TOOLS.map((tool) => tool.function.name))

export function validateToolCall(call) {
  if (!call || call.type !== 'function') return false
  const name = call.function?.name
  if (!ALLOWED.has(name)) return false
  try {
    const args = typeof call.function.arguments === 'string'
      ? JSON.parse(call.function.arguments || '{}')
      : (call.function.arguments ?? {})
    return args && typeof args === 'object' && !Array.isArray(args)
  } catch {
    return false
  }
}

export function normalizeToolCalls(message = {}) {
  const calls = message.tool_calls ?? (message.function_call ? [message.function_call] : [])
  return calls.filter(validateToolCall).map((call) => {
    let args = call.function.arguments
    if (typeof args === 'string') {
      try { args = JSON.parse(args || '{}') } catch { args = {} }
    }
    return { name: call.function.name, args: args ?? {} }
  })
}
