const EXCLUDED = ["RIZOUSDT", "VANRYUSDT"];

let coins = [
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
let socket = null;
let reconnectTimer = null;

const CONFIG = {
    tradeWindow: 15000,
    shortWindow: 3000,
    mediumWindow: 10000,
    bookLevels: 10,
    largeTradeMultiplier: 5,
    signalCooldown: 3000
};

function createMarket(symbol) {
    if (!market[symbol]) {
        market[symbol] = {
            price: 0,
            previousPrice: 0,

            trades: [],
            buyVolume: 0,
            sellVolume: 0,

            bids: [],
            asks: [],

            spread: 0,
            imbalance: 50,

            momentum: 0,
            volatility: 0,
            volumeRatio: 1,

            ema9: null,
            ema21: null,
            ema50: null,

            rsi: 50,
            macd: 0,
            signalLine: 0,

            vwap: 0,
            atr: 0,

            score: 50,
            signal: "BEKLE",

            lastSignal: null,
            lastSignalTime: 0,

            latency: 0,
            exchangeTime: 0,

            priceHistory: [],
            volumeHistory: []
        };
    }

    return market[symbol];
}

function now() {
    return Date.now();
}

function log(message, type = "") {
    const element = document.getElementById("log");

    if (!element) return;

    const line = document.createElement("div");
    line.className = "log-line " + type;

    const time = new Date().toLocaleTimeString("tr-TR", {
        hour12: false
    });

    line.innerHTML =
        `<span class="log-time">[${time}]</span> ${message}`;

    element.prepend(line);

    while (element.children.length > 150) {
        element.removeChild(element.lastChild);
    }
}

function connect() {

    if (socket) {
        try {
            socket.close();
        } catch (e) {}
    }

    updateConnection("Bağlanıyor...", "yellow");

    const streams = coins
        .filter(symbol => !EXCLUDED.includes(symbol))
        .flatMap(symbol => [
            `${symbol.toLowerCase()}@trade`,
            `${symbol.toLowerCase()}@depth10@100ms`
        ])
        .join("/");

    if (!streams) {
        updateConnection("Coin yok", "red");
        return;
    }

    const url =
        "wss://stream.binance.com:9443/stream?streams=" +
        streams;

    socket = new WebSocket(url);

    socket.onopen = () => {
        updateConnection("GERÇEK ZAMANLI BAĞLI", "green");
        log("WebSocket bağlantısı kuruldu.");
    };

    socket.onmessage = event => {

        try {

            const packet = JSON.parse(event.data);

            if (!packet.data) return;

            const data = packet.data;

            if (data.e === "trade") {
                processTrade(data);
            }

            if (
                data.e === "depthUpdate" ||
                data.b ||
                data.a
            ) {
                processBook(data);
            }

        } catch (error) {
            console.error("Veri hatası:", error);
        }
    };

    socket.onerror = () => {
        updateConnection("Bağlantı hatası", "red");
    };

    socket.onclose = () => {

        updateConnection(
            "Bağlantı kesildi — yeniden bağlanıyor",
            "red"
        );

        clearTimeout(reconnectTimer);

        reconnectTimer = setTimeout(
            connect,
            2500
        );
    };
}

function updateConnection(text, color) {

    const element =
        document.getElementById("connection");

    if (!element) return;

    const dot =
        element.querySelector(".dot");

    const label =
        element.querySelector("span:last-child");

    if (label) {
        label.textContent = text;
    } else {
        element.textContent = text;
    }

    if (dot) {

        if (color === "green") {
            dot.style.background = "#19e68c";
            dot.style.boxShadow =
                "0 0 12px #19e68c";
        }

        if (color === "red") {
            dot.style.background = "#ff4d67";
            dot.style.boxShadow =
                "0 0 12px #ff4d67";
        }

        if (color === "yellow") {
            dot.style.background = "#ffd34d";
            dot.style.boxShadow =
                "0 0 12px #ffd34d";
        }
    }
}

function processTrade(trade) {

    const symbol = trade.s;

    if (EXCLUDED.includes(symbol)) return;

    const d = createMarket(symbol);

    const price = Number(trade.p);
    const quantity = Number(trade.q);

    const eventTime = Number(trade.E);
    const current = now();

    d.latency =
        Math.max(
            0,
            current - eventTime
        );

    d.exchangeTime = eventTime;

    d.previousPrice = d.price;
    d.price = price;

    const side =
        trade.m ? "SELL" : "BUY";

    d.trades.push({
        time: current,
        price,
        quantity,
        side
    });

    d.priceHistory.push({
        time: current,
        price
    });

    d.volumeHistory.push({
        time: current,
        volume: quantity
    });

    if (side === "BUY") {
        d.buyVolume += quantity;
    } else {
        d.sellVolume += quantity;
    }

    cleanupData(d, current);

    calculateIndicators(d);

    calculateSignal(symbol);

    renderCoin(symbol);

    updateGlobalStats();
}

function processBook(book) {

    const symbol = book.s;

    if (!symbol || EXCLUDED.includes(symbol))
        return;

    const d = createMarket(symbol);

    const bids = book.b || [];
    const asks = book.a || [];

    d.bids =
        bids
        .slice(0, CONFIG.bookLevels)
        .map(row => ({
            price: Number(row[0]),
            quantity: Number(row[1])
        }));

    d.asks =
        asks
        .slice(0, CONFIG.bookLevels)
        .map(row => ({
            price: Number(row[0]),
            quantity: Number(row[1])
        }));

    calculateOrderBook(d);

    renderCoin(symbol);
}

function cleanupData(d, current) {

    d.trades =
        d.trades.filter(
            trade =>
                current - trade.time <=
                CONFIG.tradeWindow
        );

    d.priceHistory =
        d.priceHistory.filter(
            item =>
                current - item.time <=
                60000
        );

    d.volumeHistory =
        d.volumeHistory.filter(
            item =>
                current - item.time <=
                60000
        );

    let buy = 0;
    let sell = 0;

    for (const trade of d.trades) {

        if (trade.side === "BUY") {
            buy += trade.quantity;
        } else {
            sell += trade.quantity;
        }
    }

    d.buyVolume = buy;
    d.sellVolume = sell;
}

function calculateOrderBook(d) {

    if (!d.bids.length ||
        !d.asks.length) {
        return;
    }

    const bestBid =
        d.bids[0].price;

    const bestAsk =
        d.asks[0].price;

    if (bestBid > 0) {

        d.spread =
            ((bestAsk - bestBid) /
                bestBid) * 100;
    }

    let bidTotal = 0;
    let askTotal = 0;

    for (const bid of d.bids) {
        bidTotal +=
            bid.quantity;
    }

    for (const ask of d.asks) {
        askTotal +=
            ask.quantity;
    }

    const total =
        bidTotal + askTotal;

    if (total > 0) {

        d.imbalance =
            (bidTotal / total) * 100;
    }
}

function calculateIndicators(d) {

    calculateMomentum(d);
    calculateEMA(d, 9);
    calculateEMA(d, 21);
    calculateEMA(d, 50);
    calculateRSI(d);
    calculateMACD(d);
    calculateVWAP(d);
    calculateVolatility(d);
    calculateVolumeRatio(d);
}

function calculateMomentum(d) {

    if (d.priceHistory.length < 2)
        return;

    const current =
        d.priceHistory[
            d.priceHistory.length - 1
        ].price;

    const targetTime =
        now() - CONFIG.shortWindow;

    let old = null;

    for (let i = 0;
         i < d.priceHistory.length;
         i++) {

        if (
            d.priceHistory[i].time
            >= targetTime
        ) {
            old =
                d.priceHistory[
                    Math.max(0, i - 1)
                ].price;
            break;
        }
    }

    if (!old || old === 0)
        return;

    d.momentum =
        ((current - old) /
            old) * 100;
}

function calculateEMA(d, period) {

    if (d.priceHistory.length < 2)
        return;

    const key =
        period === 9
            ? "ema9"
            : period === 21
            ? "ema21"
            : "ema50";

    const price = d.price;

    if (d[key] === null) {

        d[key] = price;
        return;
    }

    const multiplier =
        2 / (period + 1);

    d[key] =
        (price - d[key]) *
        multiplier +
        d[key];
}

function calculateRSI(d) {

    const history =
        d.priceHistory;

    if (history.length < 15)
        return;

    let gains = 0;
    let losses = 0;

    const start =
        Math.max(
            1,
            history.length - 14
        );

    for (
        let i = start;
        i < history.length;
        i++
    ) {

        const diff =
            history[i].price -
            history[i - 1].price;

        if (diff > 0) {
            gains += diff;
        } else {
            losses -= diff;
        }
    }

    const averageGain =
        gains / 14;

    const averageLoss =
        losses / 14;

    if (averageLoss === 0) {
        d.rsi = 100;
        return;
    }

    const rs =
        averageGain /
        averageLoss;

    d.rsi =
        100 -
        (100 / (1 + rs));
}

function calculateMACD(d) {

    if (
        d.ema9 === null ||
        d.ema21 === null
    )
        return;

    d.macd =
        d.ema9 -
        d.ema21;

    d.signalLine =
        d.signalLine * 0.8 +
        d.macd * 0.2;
}

function calculateVWAP(d) {

    let volume = 0;
    let value = 0;

    for (const trade of d.trades) {

        volume +=
            trade.quantity;

        value +=
            trade.price *
            trade.quantity;
    }

    if (volume > 0) {

        d.vwap =
            value / volume;
    }
}

function calculateVolatility(d) {

    const history =
        d.priceHistory;

    if (history.length < 5)
        return;

    const prices =
        history
        .slice(-30)
        .map(x => x.price);

    const mean =
        prices.reduce(
            (a,b) => a + b,
            0
        ) / prices.length;

    let variance = 0;

    for (const price of prices) {

        variance +=
            Math.pow(
                price - mean,
                2
            );
    }

    variance /=
        prices.length;

    d.volatility =
        Math.sqrt(variance) /
        mean *
        100;
}

function calculateVolumeRatio(d) {

    const currentTime =
        now();

    let shortVolume = 0;
    let oldVolume = 0;

    for (
        const item of d.volumeHistory
    ) {

        const age =
            currentTime -
            item.time;

        if (age <= 3000) {

            shortVolume +=
                item.volume;

        } else if (
            age <= 15000
        ) {

            oldVolume +=
                item.volume;
        }
    }

    if (oldVolume > 0) {

        d.volumeRatio =
            shortVolume /
            (oldVolume / 4);

    } else {

        d.volumeRatio = 1;
    }
}

function calculateSignal(symbol) {

    const d = market[symbol];

    if (!d || !d.price)
        return;

    let score = 50;

    /* TRADE FLOW */

    const totalVolume =
        d.buyVolume +
        d.sellVolume;

    let pressure = 50;

    if (totalVolume > 0) {

        pressure =
            d.buyVolume /
            totalVolume *
            100;
    }

    if (pressure >= 70)
        score += 18;
    else if (pressure >= 60)
        score += 9;
    else if (pressure <= 30)
        score -= 18;
    else if (pressure <= 40)
        score -= 9;

    /* ORDER BOOK */

    if (d.imbalance >= 70)
        score += 15;
    else if (d.imbalance >= 60)
        score += 7;
    else if (d.imbalance <= 30)
        score -= 15;
    else if (d.imbalance <= 40)
        score -= 7;

    /* MOMENTUM */

    if (d.momentum > 0.30)
        score += 12;
    else if (d.momentum > 0.10)
        score += 6;
    else if (d.momentum < -0.30)
        score -= 12;
    else if (d.momentum < -0.10)
        score -= 6;

    /* EMA */

    if (
        d.ema9 !== null &&
        d.ema21 !== null
    ) {

        if (d.ema9 > d.ema21)
            score += 8;
        else
            score -= 8;
    }

    if (
        d.ema21 !== null &&
        d.ema50 !== null
    ) {

        if (d.ema21 > d.ema50)
            score += 5;
        else
            score -= 5;
    }

    /* VWAP */

    if (d.vwap > 0) {

        if (d.price > d.vwap)
            score += 5;
        else
            score -= 5;
    }

    /* RSI */

    if (d.rsi >= 55 &&
        d.rsi <= 72) {

        score += 5;

    } else if (
        d.rsi >= 28 &&
        d.rsi <= 45
    ) {

        score -= 5;
    }

    /* MACD */

    if (d.macd > d.signalLine)
        score += 5;
    else
        score -= 5;

    /* VOLUME */

    if (d.volumeRatio > 2.5) {

        if (pressure > 55)
            score += 8;

        if (pressure < 45)
            score -= 8;
    }

    score =
        Math.max(
            0,
            Math.min(
                100,
                Math.round(score)
            )
        );

    d.score = score;

    let signal;

    if (score >= 85)
        signal = "GÜÇLÜ AL";
    else if (score >= 70)
        signal = "AL";
    else if (score <= 15)
        signal = "GÜÇLÜ SAT";
    else if (score <= 30)
        signal = "SAT";
    else
        signal = "BEKLE";

    if (
        signal !== d.signal &&
        now() - d.lastSignalTime >
        CONFIG.signalCooldown
    ) {

        d.lastSignal =
            d.signal;

        d.signal =
            signal;

        d.lastSignalTime =
            now();

        if (
            signal === "AL" ||
            signal === "GÜÇLÜ AL"
        ) {

            createAlert(
                symbol,
                signal,
                d.score,
                "buy"
            );

            log(
                `${symbol} → ${signal} (${d.score}/100)`,
                "log-buy"
            );

        } else if (
            signal === "SAT" ||
            signal === "GÜÇLÜ SAT"
        ) {

            createAlert(
                symbol,
                signal,
                d.score,
                "sell"
            );

            log(
                `${symbol} → ${signal} (${d.score}/100)`,
                "log-sell"
            );
        }

    } else {

        d.signal = signal;
    }
}

function createAlert(
    symbol,
    signal,
    score,
    type
) {

    const container =
        document.getElementById("alerts");

    if (!container)
        return;

    const item =
        document.createElement("div");

    item.className =
        "alert " + type;

    const time =
        new Date().toLocaleTimeString(
            "tr-TR",
            { hour12: false }
        );

    item.innerHTML = `
        <strong>
            ${symbol.replace("USDT","")}
            — ${signal}
        </strong>
        <div>
            Sinyal gücü:
            ${score}/100
        </div>
        <div class="alert-time">
            ${time}
        </div>
    `;

    container.prepend(item);

    while (
        container.children.length > 40
    ) {

        container.removeChild(
            container.lastChild
        );
    }
}

function renderCoin(symbol) {

    const d = market[symbol];

    if (!d)
        return;

    const row =
        document.getElementById(
            `coin-${symbol}`
        );

    if (!row)
        return;

    const price =
        row.querySelector(".coin-price");

    const signal =
        row.querySelector(".coin-signal");

    const score =
        row.querySelector(".score-number");

    const fill =
        row.querySelector(".score-fill");

    const pressure =
        row.querySelector(".coin-pressure");

    const latency =
        row.querySelector(".coin-latency");

    if (price) {

        price.textContent =
            formatPrice(d.price);
    }

    if (signal) {

        signal.textContent =
            d.signal;

        signal.className =
            "signal coin-signal " +
            signalClass(d.signal);
    }

    if (score)
        score.textContent =
            d.score + "/100";

    if (fill)
        fill.style.width =
            d.score + "%";

    if (pressure) {

        const total =
            d.buyVolume +
            d.sellVolume;

        const buy =
            total > 0
                ? d.buyVolume /
                  total * 100
                : 50;

        pressure.textContent =
            buy.toFixed(1) + "%";
    }

    if (latency)
        latency.textContent =
            d.latency + " ms";
}

function signalClass(signal) {

    if (signal === "GÜÇLÜ AL")
        return "signal-strong-buy";

    if (signal === "AL")
        return "signal-buy";

    if (signal === "SAT")
        return "signal-sell";

    if (signal === "GÜÇLÜ SAT")
        return "signal-strong-sell";

    return "signal-wait";
}

function formatPrice(price) {

    if (!price)
        return "-";

    if (price >= 1000) {

        return price.toLocaleString(
            "en-US",
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        );
    }

    if (price >= 1) {

        return price.toLocaleString(
            "en-US",
            {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4
            }
        );
    }

    return price.toLocaleString(
        "en-US",
        {
            minimumFractionDigits: 6,
            maximumFractionDigits: 8
        }
    );
}

function updateGlobalStats() {

    const values =
        Object.values(market);

    const active =
        values.filter(
            x => x.price > 0
        );

    const strongBuy =
        active.filter(
            x => x.signal === "GÜÇLÜ AL"
        ).length;

    const buy =
        active.filter(
            x => x.signal === "AL"
        ).length;

    const sell =
        active.filter(
            x =>
                x.signal === "SAT" ||
                x.signal === "GÜÇLÜ SAT"
        ).length;

    const avgLatency =
        active.length
            ? active.reduce(
                (sum,x) =>
                    sum + x.latency,
                0
              ) / active.length
            : 0;

    setText(
        "stat-coins",
        active.length
    );

    setText(
        "stat-buy",
        strongBuy + buy
    );

    setText(
        "stat-sell",
        sell
    );

    setText(
        "stat-latency",
        Math.round(avgLatency) + " ms"
    );
}

function setText(id, value) {

    const element =
        document.getElementById(id);

    if (element)
        element.textContent =
            value;
}

function addCoin(symbol) {

    symbol =
        symbol
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g,"");

    if (!symbol)
        return;

    if (!symbol.endsWith("USDT"))
        symbol += "USDT";

    if (EXCLUDED.includes(symbol)) {

        alert(
            "Bu coin analiz sisteminden çıkarılmıştır."
        );

        return;
    }

    if (coins.includes(symbol))
        return;

    coins.push(symbol);

    createMarket(symbol);

    renderCoinRow(symbol);

    connect();

    log(
        `${symbol} izleme listesine eklendi.`
    );
}

function removeCoin(symbol) {

    coins =
        coins.filter(
            x => x !== symbol
        );

    const row =
        document.getElementById(
            `coin-${symbol}`
        );

    if (row)
        row.remove();

    delete market[symbol];

    connect();

    log(
        `${symbol} kaldırıldı.`
    );
}

function renderCoinRow(symbol) {

    const table =
        document.getElementById(
            "coin-list"
        );

    if (!table)
        return;

    if (
        document.getElementById(
            `coin-${symbol}`
        )
    )
        return;

    const row =
        document.createElement("tr");

    row.id =
        `coin-${symbol}`;

    row.className =
        "coin-row";

    row.innerHTML = `
        <td>
            <div class="coin-name">
                ${symbol.replace("USDT","")}
            </div>
        </td>

        <td>
            <span class="coin-price">-</span>
        </td>

        <td>
            <span class="signal signal-wait coin-signal">
                BEKLE
            </span>
        </td>

        <td>
            <div class="score-wrap">
                <div class="score-number">
                    50/100
                </div>
                <div class="score-bar">
                    <div class="score-fill"></div>
                </div>
            </div>
        </td>

        <td>
            <span class="coin-pressure">
                50%
            </span>
        </td>

        <td>
            <span class="coin-latency">
                -
            </span>
        </td>

        <td>
            <button
                class="btn btn-danger"
                onclick="removeCoin('${symbol}')"
            >
                ✕
            </button>
        </td>
    `;

    table.appendChild(row);
}

function initialize() {

    coins =
        coins.filter(
            symbol =>
                !EXCLUDED.includes(symbol)
        );

    coins.forEach(symbol => {

        createMarket(symbol);

        renderCoinRow(symbol);
    });

    connect();

    log(
        "Analiz motoru başlatıldı."
    );
}

document.addEventListener(
    "DOMContentLoaded",
    initialize
);
