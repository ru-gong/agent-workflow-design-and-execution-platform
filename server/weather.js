const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const weatherDescriptions = new Map([
  [0, "晴朗"],
  [1, "大致晴朗"],
  [2, "局部多云"],
  [3, "阴天"],
  [45, "有雾"],
  [48, "雾凇"],
  [51, "小毛毛雨"],
  [53, "中等毛毛雨"],
  [55, "强毛毛雨"],
  [56, "冻毛毛雨"],
  [57, "强冻毛毛雨"],
  [61, "小雨"],
  [63, "中雨"],
  [65, "大雨"],
  [66, "冻雨"],
  [67, "强冻雨"],
  [71, "小雪"],
  [73, "中雪"],
  [75, "大雪"],
  [77, "雪粒"],
  [80, "阵雨"],
  [81, "强阵雨"],
  [82, "暴雨"],
  [85, "阵雪"],
  [86, "强阵雪"],
  [95, "雷暴"],
  [96, "雷暴伴小冰雹"],
  [99, "雷暴伴强冰雹"]
]);

export async function getWeatherByCity(city, fetchImpl = fetch) {
  const query = String(city || "").trim();
  if (!query) {
    const error = new Error("请输入城市名称。");
    error.statusCode = 400;
    throw error;
  }

  const location = await geocodeCity(query, fetchImpl);
  const weather = await fetchCurrentWeather(location, fetchImpl);
  return { location, weather };
}

async function geocodeCity(city, fetchImpl) {
  const url = new URL(GEOCODING_URL);
  url.search = new URLSearchParams({
    name: city,
    count: "1",
    language: "zh",
    format: "json"
  }).toString();

  const data = await fetchJson(url, fetchImpl, "城市查询服务暂时不可用。");
  const match = data.results?.[0];
  if (!match) {
    const error = new Error(`未找到“${city}”，请检查城市名称或换用更具体的城市。`);
    error.statusCode = 404;
    throw error;
  }

  return {
    name: match.name,
    country: match.country || "",
    admin1: match.admin1 || "",
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: match.timezone || ""
  };
}

async function fetchCurrentWeather(location, fetchImpl) {
  const url = new URL(FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "weather_code",
      "wind_speed_10m"
    ].join(","),
    timezone: "auto"
  }).toString();

  const data = await fetchJson(url, fetchImpl, "天气服务暂时不可用。");
  if (!data.current) {
    const error = new Error("天气服务没有返回当前天气数据。");
    error.statusCode = 502;
    throw error;
  }

  const current = data.current;
  const units = data.current_units || {};
  const weatherCode = Number(current.weather_code);
  return {
    time: current.time,
    temperature: current.temperature_2m,
    temperatureUnit: units.temperature_2m || "°C",
    apparentTemperature: current.apparent_temperature,
    apparentTemperatureUnit: units.apparent_temperature || "°C",
    humidity: current.relative_humidity_2m,
    humidityUnit: units.relative_humidity_2m || "%",
    windSpeed: current.wind_speed_10m,
    windSpeedUnit: units.wind_speed_10m || "km/h",
    code: weatherCode,
    description: describeWeatherCode(weatherCode)
  };
}

async function fetchJson(url, fetchImpl, failureMessage) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    const error = new Error(`${failureMessage} 请稍后重试。`);
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`${failureMessage} 上游返回 ${response.status}。`);
    error.statusCode = 502;
    throw error;
  }

  try {
    return await response.json();
  } catch {
    const error = new Error(`${failureMessage} 返回内容无法解析。`);
    error.statusCode = 502;
    throw error;
  }
}

export function describeWeatherCode(code) {
  return weatherDescriptions.get(Number(code)) || "天气状况未知";
}
