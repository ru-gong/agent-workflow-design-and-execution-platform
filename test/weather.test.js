import test from "node:test";
import assert from "node:assert/strict";
import { describeWeatherCode, getWeatherByCity } from "../server/weather.js";

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

test("getWeatherByCity geocodes city and normalizes current weather", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return jsonResponse({
        results: [
          {
            name: "上海",
            country: "中国",
            admin1: "上海市",
            latitude: 31.23,
            longitude: 121.47,
            timezone: "Asia/Shanghai"
          }
        ]
      });
    }
    return jsonResponse({
      current: {
        time: "2026-05-13T13:00",
        temperature_2m: 26.4,
        apparent_temperature: 28.2,
        relative_humidity_2m: 64,
        wind_speed_10m: 12.5,
        weather_code: 2
      },
      current_units: {
        temperature_2m: "°C",
        apparent_temperature: "°C",
        relative_humidity_2m: "%",
        wind_speed_10m: "km/h"
      }
    });
  };

  const result = await getWeatherByCity(" 上海 ", fetchImpl);

  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).searchParams.get("name"), "上海");
  assert.equal(result.location.name, "上海");
  assert.equal(result.weather.temperature, 26.4);
  assert.equal(result.weather.description, "局部多云");
});

test("getWeatherByCity returns useful validation and not-found errors", async () => {
  await assert.rejects(() => getWeatherByCity(" ", async () => jsonResponse({})), /请输入城市名称/);
  await assert.rejects(
    () => getWeatherByCity("不存在之城", async () => jsonResponse({ results: [] })),
    /未找到“不存在之城”/
  );
});

test("describeWeatherCode falls back for unknown weather codes", () => {
  assert.equal(describeWeatherCode(0), "晴朗");
  assert.equal(describeWeatherCode(999), "天气状况未知");
});
