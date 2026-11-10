-- Stand-in for BeamNG's vehicle Lua environment (electrics, controller, input)
-- so the real bridge code can be exercised without the game.
local state = {
  ignition = 0, starter = false, crank = 0, running = false,
  lightbar = 0, lights = 0, fog = false, hazard = false,
  left = false, right = false, horn = false, parkingbrake = 1,
  blink = 0, pulse = false, speed = 0, targetSpeed = 0, gear = 'P',
  hasEngine = true,
}

electrics = { values = {} }
local v = electrics.values

function electrics.setIgnitionLevel(level)
  state.ignition = level
  if level < 2 then state.running = false state.starter = false end
end
function electrics.set_lightbar_signal(n) state.lightbar = n end
function electrics.toggle_lightbar_signal() state.lightbar = (state.lightbar + 1) % 3 end
function electrics.setLightsState(n) state.lights = n end
function electrics.toggle_lights() state.lights = (state.lights + 1) % 3 end
function electrics.set_fog_lights(on) state.fog = on end
function electrics.toggle_fog_lights() state.fog = not state.fog end
function electrics.set_warn_signal(on) state.hazard = on state.blink = 0 state.pulse = on end
function electrics.toggle_warn_signal() electrics.set_warn_signal(not state.hazard) end
function electrics.toggle_left_signal()
  state.left = not state.left state.right = false state.blink = 0 state.pulse = state.left
end
function electrics.toggle_right_signal()
  state.right = not state.right state.left = false state.blink = 0 state.pulse = state.right
end
function electrics.horn(on) state.horn = on end

controller = { mainController = {} }
function controller.mainController.setStarter(on)
  state.starter = on
  if on then state.crank = 0 end
end

powertrain = {}
function powertrain.getDevicesByCategory(category)
  if category == 'engine' and state.hasEngine then return { { type = 'combustionEngine' } } end
  return {}
end

input = {}
function input.toggleEvent(name)
  if name == 'parkingbrake' then state.parkingbrake = state.parkingbrake > 0.5 and 0 or 1 end
end

FILTER_DIRECT = 2
obj = {}
function obj:getID() return MOCK_VEHICLE_ID end
function obj:queueGameEngineLua(code) mockQueueGE(code) end
function log(level, tag, msg) mockLog(level, tag, msg) end

function mockValuesJson()
  local parts = {}
  for k, val in pairs(v) do
    parts[#parts + 1] = string.format('%q:%s', k, type(val) == 'string' and string.format('%q', val) or tostring(val))
  end
  return '{' .. table.concat(parts, ',') .. '}'
end

function mockSet(key, value) state[key] = value end

function mockUpdate(dt)
  if state.starter and state.ignition >= 2 and not state.running then
    state.crank = state.crank + dt
    if state.crank > 0.8 then state.running = true end
  end
  if state.hazard or state.left or state.right then
    state.blink = state.blink + dt
    if state.blink > 0.35 then state.blink = 0 state.pulse = not state.pulse end
  end
  local target = state.running and state.targetSpeed or 0
  state.speed = state.speed + (target - state.speed) * math.min(1, dt * 1.5)
  if state.speed < 0.05 then state.speed = 0 end

  v.ignitionLevel = state.ignition
  v.engineRunning = state.running and 1 or 0
  v.lightbar = state.lightbar
  v.lights_state = state.lights
  v.lowbeam = state.lights == 1 and 1 or 0
  v.highbeam = state.lights == 2 and 1 or 0
  v.fog = state.fog and 1 or 0
  v.hazard_enabled = state.hazard and 1 or 0
  v.signal_left_input = state.left and 1 or 0
  v.signal_right_input = state.right and 1 or 0
  v.signal_L = (state.pulse and (state.hazard or state.left)) and 1 or 0
  v.signal_R = (state.pulse and (state.hazard or state.right)) and 1 or 0
  v.horn = state.horn and 1 or 0
  v.parkingbrake = state.parkingbrake
  v.parkingbrake_input = state.parkingbrake
  v.gear = state.gear
  v.wheelspeed = state.speed
  v.rpm = state.running and (800 + state.speed * 90) or 0
  v.fuel = 0.62
end

mockUpdate(0)
