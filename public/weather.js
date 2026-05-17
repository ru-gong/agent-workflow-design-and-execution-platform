const $ = (id) => document.getElementById(id);

const form = $("weatherForm");
const cityInput = $("cityInput");
const searchButton = $("searchButton");
const statusMessage = $("statusMessage");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const city = cityInput.value.trim();
  if (!city) {
    showError("请输入城市名称。");
    cityInput.focus();
    return;
  }

  setState("loading");
  searchButton.disabled = true;
  statusMessage.className = "notice";
  statusMessage.textContent = `正在查询“${city}”的天气...`;

  try {
    const data = await api(`/api/weather?city=${encodeURIComponent(city)}`);
    renderWeather(data);
    statusMessage.textContent = "查询完成。";
  } catch (error) {
    showError(error.message);
  } finally {
    searchButton.disabled = false;
  }
});

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}

function setState(name) {
  $("emptyState").classList.toggle("hidden", name !== "empty");
  $("loadingState").classList.toggle("hidden", name !== "loading");
  $("errorState").classList.toggle("hidden", name !== "error");
  $("weatherResult").classList.toggle("hidden", name !== "result");
}

function renderWeather(data) {
  const { location, weather } = data;
  $("locationName").textContent = location.name;
  $("locationMeta").textContent = [location.admin1, location.country, location.timezone].filter(Boolean).join(" · ");
  $("updatedAt").textContent = formatTime(weather.time);
  $("temperature").textContent = `${formatNumber(weather.temperature)}${weather.temperatureUnit}`;
  $("description").textContent = weather.description;
  $("apparentTemperature").textContent = `${formatNumber(weather.apparentTemperature)}${weather.apparentTemperatureUnit}`;
  $("humidity").textContent = `${formatNumber(weather.humidity)}${weather.humidityUnit}`;
  $("windSpeed").textContent = `${formatNumber(weather.windSpeed)} ${weather.windSpeedUnit}`;
  $("weatherCode").textContent = String(weather.code);
  setState("result");
}

function showError(message) {
  $("errorText").textContent = message || "请稍后重试。";
  statusMessage.className = "notice bad";
  statusMessage.textContent = message || "查询失败。";
  setState("error");
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : "--";
}

function formatTime(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

setState("empty");
