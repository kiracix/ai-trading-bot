"use strict";

const EXCLUDED = new Set(["RIZOUSDT", "VANRYUSDT"]);

const COINS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT"
];

const market = {};

COINS.forEach(symbol => {
  if (!EXCLUDED.has(symbol)) {
    market[symbol] = {
      price: 0,
      previousPrice: 0,
      trades: [],
      prices: [],
      bids: [],
      asks: [],
      buyVolume: 0,
      sellVolume: 0,
      score: 50,
      signal: "WAIT",
      momentum: 0,
      pressure: 50,
      tradeCount: 0
    };
  }
});

let socket = null;
let reconnectTimer = null;
let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function priceFormat(p) {
  if (!p) return "-";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(6);
  return p.toFixed(8);
}

function buildURL() {
  const streams = [];

  COINS.forEach(symbol => {
    if (EXCLUDED.has(symbol)) return;

    const s = symbol.toLowerCase();

    streams.push(`${s}@trade`);
    streams.push(`${s}@depth10@100ms`);
  });

  return "wss://stream.binance.com:9443/stream?streams=" +
    streams.join("/");
}

function setConnection(text) {
  setText("connectionStatus", text);
  setText("connection", text);
}

function connect() {
  if (socket) {
    try {
      socket.close();
    } catch (_) {}
  }

  setConnection("Bağlanıyor...");

  socket = new WebSocket(buildURL());

  socket.onopen = () => {
    setConnection("GERÇEK ZAMANLI");
    console.log("Binance WebSocket bağlandı");
  };

  socket.onmessage = event => {
    totalMessages++;

    try {
      const packet = JSON.parse(event.data);
      const data = packet.data;

      if (!data || !data.s) return;

      const symbol = data.s.toUpperCase();

      if (EXCLUDED.has(symbol)) return;
      if (!market[symbol]) return;

      if (data.e === "trade") {
        handleTrade(symbol, data);
      }

      if (data.e === "depthUpdate") {
        handleBook(symbol, data);
      }

      updateGlobal();
    } catch (error) {
      console.error(error);
    }
  };

  socket.onerror = error => {
    console.error("WebSocket:", error);
    setConnection("Bağlantı hatası");
  };

  socket.onclose = () => {
    setConnection("Yeniden bağlanıyor...");

    clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(() => {
      connect();
    }, 3000);
  };
}

function handleTrade(symbol, data) {
  const m = market[symbol];

  const price = Number(data.p);
  const quantity = Number(data.q);
  const time = Number(data.T) || Date.now();

  if (!Number.isFinite(price)) return;

  m.previousPrice = m.price;
  m.price = price;

  const isSell = Boolean(data.m);

  m.trades.push({
    time,
    price,
    quantity,
    side: isSell ? "SELL" : "BUY"
  });

  m.prices.push({
    time,
    price
  });

  if (isSell) {
    m.sellVolume += quantity;
  } else {
    m.buyVolume += quantity;
  }

  m.tradeCount++;
  totalTrades++;

  cleanup(m);
  calculate(m);
}

function handleBook(symbol, data) {
  const m = market[symbol];

  m.bids = (data.bids || []).slice(0, 10).map(x => ({
    price: Number(x[0]),
    quantity: Number(x[1])
  }));

  m.asks = (data.asks || []).slice(0, 10).map(x => ({
    price: Number(x[0]),
    quantity: Number(x[1])
  }));

  totalBooks++;

  calculate(m);
}

function cleanup(m) {
  const cutoff = Date.now() - 15000;

  while (m.trades.length && m.trades[0].time < cutoff) {
    const old = m.trades.shift();

    if (old.side === "BUY") {
      m.buyVolume -= old.quantity;
    } else {
      m.sellVolume -= old.quantity;
    }
  }

  const priceCutoff = Date.now() - 60000;

  while (
    m.prices.length &&
    m.prices[0].time < priceCutoff
  ) {
    m.prices.shift();
  }
}

function calculate(m) {
  let score = 50;

  const volume =
    m.buyVolume + m.sellVolume;

  if (volume > 0) {
    m.pressure =
      (m.buyVolume / volume) * 100;

    score +=
      (m.pressure - 50) * 0.45;
  }

  if (m.prices.length >= 2) {
    const first = m.prices[0].price;
    const last =
      m.prices[m.prices.length - 1].price;

    if (first > 0) {
      m.momentum =
        ((last - first) / first) * 100;

      score += m.momentum * 7;
    }
  }

  let bids = 0;
  let asks = 0;

  m.bids.forEach(x => bids += x.quantity);
  m.asks.forEach(x => asks += x.quantity);

  if (bids + asks > 0) {
    const bookPressure =
      bids / (bids + asks) * 100;

    score +=
      (bookPressure - 50) * 0.25;
  }

  m.score =
    Math.max(0, Math.min(100, score));

  if (m.score >= 80) {
    m.signal = "STRONG BUY";
  } else if (m.score >= 65) {
    m.signal = "BUY";
  } else if (m.score <= 20) {
    m.signal = "STRONG SELL";
  } else if (m.score <= 35) {
    m.signal = "SELL";
  } else {
    m.signal = "WAIT";
  }
}

function updateGlobal() {
  const active = Object.values(market)
    .filter(m => m.price > 0).length;

  setText("activeCoins", active);
  setText("totalMessages", totalMessages);
  setText("totalTrades", totalTrades);
  setText("totalBooks", totalBooks);

  renderCoins();
}

function renderCoins() {
  const table =
    document.querySelector("#coinTable tbody");

  if (!table) return;

  table.innerHTML = "";

  Object.entries(market)
    .sort((a, b) => b[1].score - a[1].score)
    .forEach(([symbol, m]) => {

      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${symbol.replace("USDT", "")}</td>
        <td>${priceFormat(m.price)}</td>
        <td>${m.momentum.toFixed(3)}%</td>
        <td>${m.signal}</td>
        <td>${m.score.toFixed(1)}</td>
        <td>${m.pressure.toFixed(1)}%</td>
        <td>${m.tradeCount}</td>
      `;

      table.appendChild(row);
    });
}

document.addEventListener("DOMContentLoaded", () => {
  setConnection("Bağlanıyor...");
  connect();

  setInterval(() => {
    Object.values(market).forEach(cleanup);
    updateGlobal();
  }, 500);
});
