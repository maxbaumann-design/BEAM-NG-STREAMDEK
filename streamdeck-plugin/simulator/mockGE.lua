-- Stand-in for BeamNG's game engine Lua environment.
function log(level, tag, msg) mockLog(level, tag, msg) end
local loadCode = loadstring or load
function jsonDecode(text) return loadCode('return ' .. mockJsonToLua(text))() end
function jsonReadFile(path) return jsonDecode(mockConfigJson) end

package.preload.socket = function()
  local udp = {}
  function udp:settimeout() end
  function udp:setsockname(address, port) mockBind(address, port) return 1 end
  function udp:receivefrom()
    local packet = mockReceive()
    if not packet then return nil, 'timeout' end
    local ip, port, data = packet:match('^([^\n]*)\n([^\n]*)\n(.*)$')
    return data, ip, tonumber(port)
  end
  function udp:sendto(data, ip, port) mockSend(data, ip, port) return 1 end
  function udp:close() mockClose() end
  return { udp = function() return udp end }
end

local vehicle = {}
function vehicle:getID() return mockVehicleId end
function vehicle:getJBeamFilename() return mockVehicleName end
function vehicle:queueLuaCommand(code) mockQueueVehicle(mockVehicleId, code) end

mockVehicleId = nil
mockVehicleName = ''
be = {}
function be:getPlayerVehicle() return mockVehicleId and vehicle or nil end

extensions = {}
function mockLoadExtension(name, source)
  local chunk = assert(loadCode(source, '=' .. name .. '.lua'))
  local M = chunk()
  extensions[name] = M
  if M.onExtensionLoaded then M.onExtensionLoaded() end
end
