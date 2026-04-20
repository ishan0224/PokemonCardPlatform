redis.call("ZADD", KEYS[1], "NX", ARGV[2], ARGV[1])
redis.call("PEXPIRE", KEYS[1], ARGV[4])

local closed = redis.call("GET", KEYS[2])
if closed ~= "1" then
  return { "pending" }
end

local cohortSize = tonumber(redis.call("GET", KEYS[3]) or "0")
if cohortSize <= 0 then
  return { "loser" }
end

local cohort = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", "+inf", "LIMIT", 0, cohortSize)
for i = 1, #cohort do
  if cohort[i] == ARGV[1] then
    redis.call("PSETEX", KEYS[4], ARGV[3], "1")
    return { "winner" }
  end
end

return { "loser" }
