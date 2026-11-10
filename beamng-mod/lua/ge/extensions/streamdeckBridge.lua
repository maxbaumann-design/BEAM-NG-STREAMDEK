-- Stream Deck Bridge for BeamNG.drive
--
-- Opens a UDP socket (default 127.0.0.1:4455). The Stream Deck plugin sends
-- "hello" heartbeats and commands; the bridge answers with the live state of
-- the player vehicle so the keys can mirror what is active in the game.
--
-- Optional config file (user folder): settings/streamdeckBridge.json
--   { "address": "127.0.0.1", "port": 4455, "rate": 15 }
-- Use "address": "0.0.0.0" if the Stream Deck software runs on another PC.

local M = {}

local PROTOCOL = 1
local AGENT_VERSION = 1
local logTag = 'streamdeckBridge'

local config = { address = '127.0.0.1', port = 4455, rate = 15 }

local CLIENT_TIMEOUT = 5 -- seconds without a packet until a client is dropped
local KEEPALIVE = 0.5 -- resend unchanged state this often
local AGENT_TIMEOUT = 1 -- no vehicle reply for this long -> (re)install agent

local udp = nil
local clients = {}
local hasClients = false

local now = 0 -- seconds since the extension was loaded
local pollTimer = 0
local lastSend = -1
local lastPayload = nil

local vehId = nil
local vehData = nil
local vehDataTime = -1
local lastBootstrap = -10

-- ---------------------------------------------------------------------------
-- Code that runs inside the vehicle Lua VM. It is installed on demand with
-- queueLuaCommand, so it also survives vehicle reloads and vehicle switches.
-- ---------------------------------------------------------------------------
local AGENT_SRC = [==[
local A = { version = __AGENT_VERSION__ }
local now = 0
local starterUntil = nil
local lastStartAttempt = -100
local iceCached = nil

local function on(x)
  if type(x) == 'number' then return x > 0.5 end
  return x == true
end

local function num(x, default)
  if type(x) == 'number' and x == x and x ~= math.huge and x ~= -math.huge then return x end
  if x == true then return 1 end
  return default or 0
end

local function try(f, ...)
  if type(f) ~= 'function' then return false end
  local ok, err = pcall(f, ...)
  if not ok then log('W', 'streamdeckAgent', tostring(err)) end
  return ok
end

local function mainController()
  return controller and controller.mainController or nil
end

local function hasCombustionEngine()
  if iceCached == nil then
    iceCached = false
    pcall(function()
      for _, d in pairs(powertrain.getDevicesByCategory('engine') or {}) do
        if d.type == 'combustionEngine' then iceCached = true end
      end
    end)
  end
  return iceCached
end

local function ignitionLevel()
  local v = electrics.values
  if type(v.ignitionLevel) == 'number' then return v.ignitionLevel end
  if on(v.ignition) or on(v.engineRunning) then return 2 end
  return 0
end

local function engineRunning()
  return on(electrics.values.engineRunning)
end

local function setStarter(enabled)
  local mc = mainController()
  if mc and mc.setStarter then return try(mc.setStarter, enabled) end
  return false
end

local function setIgnition(level)
  if electrics.setIgnitionLevel then
    try(electrics.setIgnitionLevel, level)
  else
    local mc = mainController()
    if mc and mc.setEngineIgnition then try(mc.setEngineIgnition, level >= 2) end
  end
end

local function powerOff()
  if starterUntil then setStarter(false) starterUntil = nil end
  setIgnition(0)
end

local function powerOn(startEngine)
  setIgnition(2)
  if startEngine and hasCombustionEngine() and not engineRunning() then
    lastStartAttempt = now
    if setStarter(true) then starterUntil = now + 5 end
  end
end

-- sets a cycling electrics state, preferring a direct setter over toggling
local function setCycle(current, target, count, setter, toggler)
  if current == target then return end
  if setter then
    try(setter, target)
  elseif toggler then
    for _ = 1, (target - current) % count do try(toggler) end
  end
end

local function lightbar() return math.floor(num(electrics.values.lightbar) + 0.5) end
local function lights() return math.floor(num(electrics.values.lights_state) + 0.5) end

local function setLightbar(target)
  setCycle(lightbar(), target, 3, electrics.set_lightbar_signal, electrics.toggle_lightbar_signal)
end

local function setLights(target)
  setCycle(lights(), target, 3, electrics.setLightsState, electrics.toggle_lights)
end

local function wanted(action, current)
  if action == 'on' then return true end
  if action == 'off' then return false end
  return not current
end

local commands = {}

-- vehicle on/off. val = 1: ignition only, otherwise the engine is started too
function commands.power(action, val)
  local ignitionOnly = val == 1 or not hasCombustionEngine()
  local ign, running = ignitionLevel(), engineRunning()
  if action == 'on' then return powerOn(not ignitionOnly) end
  if action == 'off' then return powerOff() end
  if running then return powerOff() end
  if ign >= 1 and (ignitionOnly or now - lastStartAttempt < 8) then return powerOff() end
  powerOn(not ignitionOnly)
end

-- blue lights without siren
function commands.lightbar(action)
  setLightbar(wanted(action, lightbar() > 0) and 1 or 0)
end

-- siren (the game only allows it together with the lights)
function commands.siren(action)
  setLightbar(wanted(action, lightbar() >= 2) and 2 or 1)
end

-- off -> lights -> lights + siren -> off
function commands.emergency(action, val)
  if action == 'set' then return setLightbar(math.max(0, math.min(2, math.floor(num(val))))) end
  if action == 'on' then return setLightbar(2) end
  if action == 'off' then return setLightbar(0) end
  setLightbar((lightbar() + 1) % 3)
end

-- off -> low beam -> high beam -> off
function commands.lights(action, val)
  if action == 'set' then return setLights(math.max(0, math.min(2, math.floor(num(val))))) end
  if action == 'on' then return setLights(1) end
  if action == 'off' then return setLights(0) end
  setLights((lights() + 1) % 3)
end

function commands.highbeam(action)
  setLights(wanted(action, lights() >= 2) and 2 or 1)
end

function commands.fog(action)
  local cur = on(electrics.values.fog)
  local target = wanted(action, cur)
  if target == cur then return end
  if electrics.set_fog_lights then try(electrics.set_fog_lights, target)
  else try(electrics.toggle_fog_lights) end
end

function commands.hazard(action)
  local cur = on(electrics.values.hazard_enabled)
  local target = wanted(action, cur)
  if target == cur then return end
  if electrics.set_warn_signal then try(electrics.set_warn_signal, target)
  else try(electrics.toggle_warn_signal) end
end

function commands.signal_l(action)
  if wanted(action, on(electrics.values.signal_left_input)) ~= on(electrics.values.signal_left_input) then
    try(electrics.toggle_left_signal)
  end
end

function commands.signal_r(action)
  if wanted(action, on(electrics.values.signal_right_input)) ~= on(electrics.values.signal_right_input) then
    try(electrics.toggle_right_signal)
  end
end

function commands.horn(action)
  try(electrics.horn, action == 'press' or action == 'on')
end

function commands.parkingbrake(action)
  local cur = num(electrics.values.parkingbrake_input, num(electrics.values.parkingbrake)) > 0.5
  local target = wanted(action, cur)
  if target == cur then return end
  if input and input.toggleEvent then
    try(input.toggleEvent, 'parkingbrake')
  elseif input and input.event then
    try(input.event, 'parkingbrake', target and 1 or 0, FILTER_DIRECT or 2)
  end
end

local function round(x, step) return math.floor(x / step + 0.5) * step end

local function lit(v)
  local t = type(v)
  if t == 'number' then
    if v == math.floor(v) then return string.format('%d', v) end
    return string.format('%.3f', v)
  elseif t == 'boolean' then
    return v and 'true' or 'false'
  end
  return string.format('%q', tostring(v))
end

function A.report(t)
  now = t or now
  local v = electrics.values
  local running = engineRunning()

  if starterUntil and (running or now > starterUntil) then
    setStarter(false)
    starterUntil = nil
  end

  local state = {
    ign = ignitionLevel(),
    run = running,
    ice = hasCombustionEngine(),
    lb = lightbar(),
    lights = lights(),
    hi = on(v.highbeam),
    fog = on(v.fog),
    haz = on(v.hazard_enabled),
    sl = on(v.signal_left_input),
    sr = on(v.signal_right_input),
    bl = on(v.signal_L),
    br = on(v.signal_R),
    horn = on(v.horn),
    pb = num(v.parkingbrake) > 0.5,
    gear = tostring(v.gear or ''),
    spd = round(math.abs(num(v.wheelspeed, num(v.airspeed))), 0.1),
    rpm = round(num(v.rpm), 10),
    fuel = round(num(v.fuel), 0.01),
  }

  local parts = {}
  for k, val in pairs(state) do parts[#parts + 1] = k .. '=' .. lit(val) end
  obj:queueGameEngineLua('if extensions.streamdeckBridge then extensions.streamdeckBridge.onVehicleData('
    .. obj:getID() .. ',{' .. table.concat(parts, ',') .. '}) end')
end

function A.cmd(id, action, val, t)
  now = t or now
  local f = commands[id]
  if f then
    local ok, err = pcall(f, action, val)
    if not ok then log('W', 'streamdeckAgent', id .. ': ' .. tostring(err)) end
  end
end

streamdeckAgent = A
]==]

AGENT_SRC = AGENT_SRC:gsub('__AGENT_VERSION__', tostring(AGENT_VERSION))

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
local function jsonValue(v)
  local t = type(v)
  if t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return '0' end
    if v == math.floor(v) then return string.format('%d', v) end
    return string.format('%.3f', v)
  elseif t == 'boolean' then
    return v and 'true' or 'false'
  elseif t == 'string' then
    return '"' .. v:gsub('[%c"\\]', function(c) return string.format('\\u%04x', c:byte()) end) .. '"'
  end
  return 'null'
end

local function jsonFlat(tbl)
  local keys = {}
  for k in pairs(tbl) do keys[#keys + 1] = k end
  table.sort(keys)
  local parts = {}
  for _, k in ipairs(keys) do parts[#parts + 1] = jsonValue(tostring(k)) .. ':' .. jsonValue(tbl[k]) end
  return '{' .. table.concat(parts, ',') .. '}'
end

local function playerVehicle()
  local veh = be and be:getPlayerVehicle(0) or nil
  if veh then return veh, veh:getID() end
  return nil, nil
end

local function buildPayload()
  local veh, id = playerVehicle()
  if not veh or not vehData or id ~= vehId or now - vehDataTime > AGENT_TIMEOUT * 2 then
    return string.format('{"t":"state","v":%d,"veh":false}', PROTOCOL)
  end
  local name = ''
  pcall(function() name = veh:getJBeamFilename() or '' end)
  return string.format('{"t":"state","v":%d,"veh":true,"name":%s,"s":%s}', PROTOCOL, jsonValue(name), jsonFlat(vehData))
end

local function broadcast(force)
  if not udp or not hasClients then return end
  local payload = buildPayload()
  if not force and payload == lastPayload and now - lastSend < KEEPALIVE then return end
  lastPayload = payload
  lastSend = now
  for _, c in pairs(clients) do udp:sendto(payload, c.ip, c.port) end
end

local function touchClient(ip, port)
  local key = ip .. ':' .. port
  local c = clients[key]
  if not c then
    c = { ip = ip, port = port }
    clients[key] = c
    log('I', logTag, 'Stream Deck connected from ' .. key)
  end
  c.seen = now
  hasClients = true
  return c
end

local function pruneClients()
  local any = false
  for key, c in pairs(clients) do
    if now - c.seen > CLIENT_TIMEOUT then
      clients[key] = nil
      log('I', logTag, 'Stream Deck disconnected: ' .. key)
    else
      any = true
    end
  end
  hasClients = any
end

local function pollVehicle()
  local veh, id = playerVehicle()
  if id ~= vehId then
    vehId = id
    vehData = nil
    vehDataTime = -1
    lastBootstrap = -10
  end
  if not veh then return end

  if now - vehDataTime > AGENT_TIMEOUT and now - lastBootstrap > AGENT_TIMEOUT then
    lastBootstrap = now
    veh:queueLuaCommand(AGENT_SRC)
  end
  veh:queueLuaCommand(string.format(
    'if streamdeckAgent and streamdeckAgent.version == %d then streamdeckAgent.report(%.3f) end', AGENT_VERSION, now))
end

local function handleCommand(msg)
  local id, action = msg.id, msg.a or 'toggle'
  -- these strings end up in Lua code for the vehicle, so only plain words pass
  if type(id) ~= 'string' or not id:match('^[%a_]+$') or #id > 32 then return end
  if type(action) ~= 'string' or not action:match('^[%a_]+$') or #action > 32 then return end
  local val = tonumber(msg.val)
  if val and (val ~= val or val == math.huge or val == -math.huge) then val = nil end

  local veh = playerVehicle()
  if not veh then return end
  veh:queueLuaCommand(string.format(
    'if streamdeckAgent then streamdeckAgent.cmd(%q,%q,%s,%.3f) streamdeckAgent.report(%.3f) end',
    id, action, val and string.format('%.3f', val) or 'nil', now, now))
end

local function receive()
  for _ = 1, 32 do
    local data, ip, port = udp:receivefrom()
    if not data then return end
    local ok, msg = pcall(jsonDecode, data)
    if ok and type(msg) == 'table' then
      if msg.t == 'hello' then
        local isNew = not clients[ip .. ':' .. port]
        touchClient(ip, port)
        if isNew then broadcast(true) end
      elseif msg.t == 'cmd' then
        touchClient(ip, port)
        handleCommand(msg)
      end
    end
  end
end

local function loadConfig()
  local ok, data = pcall(function() return jsonReadFile('settings/streamdeckBridge.json') end)
  if ok and type(data) == 'table' then
    if type(data.address) == 'string' then config.address = data.address end
    if tonumber(data.port) then config.port = tonumber(data.port) end
    if tonumber(data.rate) then config.rate = math.max(2, math.min(60, tonumber(data.rate))) end
  end
end

local function closeSocket()
  if udp then
    pcall(function() udp:close() end)
    udp = nil
  end
end

local function openSocket()
  closeSocket()
  local ok, socket = pcall(require, 'socket')
  if not ok or type(socket) ~= 'table' then
    log('E', logTag, 'LuaSocket is not available: ' .. tostring(socket))
    return
  end
  local s, err = socket.udp()
  if not s then
    log('E', logTag, 'Could not create UDP socket: ' .. tostring(err))
    return
  end
  s:settimeout(0)
  local bound, bindErr = s:setsockname(config.address, config.port)
  if not bound then
    log('E', logTag, string.format('Could not bind %s:%d (%s). Is another instance running?',
      config.address, config.port, tostring(bindErr)))
    s:close()
    return
  end
  udp = s
  log('I', logTag, string.format('Listening for the Stream Deck plugin on %s:%d', config.address, config.port))
end

-- ---------------------------------------------------------------------------
-- extension hooks
-- ---------------------------------------------------------------------------
local function onVehicleData(id, data)
  if id ~= vehId or type(data) ~= 'table' then return end
  vehData = data
  vehDataTime = now
  broadcast(false)
end

local function onUpdate(dtReal)
  now = now + (dtReal or 0)
  if not udp then return end

  receive()
  if not hasClients then return end

  pollTimer = pollTimer + (dtReal or 0)
  if pollTimer >= 1 / config.rate then
    pollTimer = 0
    pruneClients()
    pollVehicle()
    broadcast(false)
  end
end

local function onExtensionLoaded()
  loadConfig()
  openSocket()
end

local function onExtensionUnloaded()
  closeSocket()
end

M.onUpdate = onUpdate
M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onVehicleData = onVehicleData

return M
