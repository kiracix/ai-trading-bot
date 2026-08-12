"use strict";

console.log("APP.JS ÇALIŞIYOR - V5");

const EXCLUDED = new Set([
    "RIZOUSDT",
    "VANRYUSDT"
]);

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

let socket = null;

let totalMessages = 0;
let totalTrades = 0;
let totalBooks = 0;

COINS.forEach(symbol => {

    if (EXCLUDED.has(symbol)) return;

    market[symbol] = {
        price: 0,
        trades: 0,
        books: 0,
        buyVolume: 0,
        sellVolume: 0,
        bids: [],
        asks: [],
        score: 50,
        signal: "WAIT",
        momentum: 0,
        pressure: 50,
        prices: []
    };
});


function setText(id, value) {

    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


function priceFormat(price) {

    if (!price) return "-";

    if (price >= 1000)
        return price.toFixed(2);

    if (price >= 1)
        return price.toFixed(4);

    if (price >= 0.01)
        return price.toFixed(6);

    return price.toFixed(8);
}


function setConnection(text) {

    setText("connectionStatus", text);

    setText("connection", text);
}


function showDebug(text) {

    let box = document.getElementById("debug");

    if (!box) {

        box = document.createElement("div");

        box.id = "debug";

        box.style.cssText = `
            position:fixed;
            bottom:10px;
            left:10px;
            right:10px;
            z-index:99999;
            padding:12px;
            background:#111;
            color:#00ff88;
            font-family:monospace;
            font-size:13px;
            border-radius:8px;
        `;

        document.body.appendChild(box);
    }

    box.textContent = text;
}


function buildURL() {

    const streams = [];

    COINS.forEach(symbol => {

        if (EXCLUDED.has(symbol)) return;

        const s = symbol.toLowerCase();

        streams.push(`${s}@trade`);

        streams.push(`${s}@depth10@100ms`);
    });

    return (
        "wss://stream.binance.com:9443/stream?streams=" +
        streams.join("/")
    );
}


function connect() {

    setConnection("Bağlanıyor...");

    showDebug("APP.JS ÇALIŞIYOR — Binance bağlantısı hazırlanıyor...");

    const url = buildURL();

    console.log("WebSocket URL:", url);

    try {

        socket = new WebSocket(url);

    } catch (error) {

        console.error(error);

        setConnection("WebSocket HATASI");

        showDebug(
            "WebSocket oluşturulamadı: " +
            error.message
        );

        return;
    }


    socket.onopen = function() {

        console.log("WEBSOCKET OPEN");

        setConnection("GERÇEK ZAMANLI");

        showDebug(
            "WEBSOCKET BAĞLANDI — Binance veri bekleniyor..."
        );
    };


    socket.onmessage = function(event) {

        totalMessages++;

        try {

            const packet =
                JSON.parse(event.data);

            const data =
                packet.data;

            if (!data) return;

            const symbol =
                String(data.s || "")
                    .toUpperCase();

            if (!symbol) return;

            if (EXCLUDED.has(symbol)) return;

            if (!market[symbol]) return;


            if (data.e === "trade") {

                processTrade(
                    symbol,
                    data
                );

            }


            if (data.e === "depthUpdate") {

                processBook(
                    symbol,
                    data
                );
            }


            updateCounters();

        } catch (error) {

            console.error(
                "DATA ERROR",
                error
            );

            showDebug(
                "VERİ OKUMA HATASI: " +
                error.message
            );
        }
    };


    socket.onerror = function(error) {

        console.error(
            "WEBSOCKET ERROR",
            error
        );

        setConnection(
            "BAĞLANTI HATASI"
        );

        showDebug(
            "WEBSOCKET HATASI — Konsolu kontrol ediyoruz."
        );
    };


    socket.onclose = function() {

        setConnection(
            "YENİDEN BAĞLANIYOR..."
        );

        showDebug(
            "WebSocket kapandı. 3 saniye sonra tekrar bağlanacak."
        );

        setTimeout(
            connect,
            3000
        );
    };
}


function processTrade(
    symbol,
    data
) {

    const m =
        market[symbol];

    const price =
        Number(data.p);

    const quantity =
        Number(data.q);

    if (!price) return;

    m.price = price;

    const sell =
        Boolean(data.m);

    if (sell) {

        m.sellVolume +=
            quantity;

    } else {

        m.buyVolume +=
            quantity;
    }

    m.trades++;

    totalTrades++;

    m.prices.push({
        time: Date.now(),
        price: price
    });

    const cutoff =
        Date.now() - 60000;

    m.prices =
        m.prices.filter(
            x => x.time >= cutoff
        );

    calculateSignal(m);
}


function processBook(
    symbol,
    data
) {

    const m =
        market[symbol];

    m.bids =
        (data.bids || [])
            .slice(0, 10);

    m.asks =
        (data.asks || [])
            .slice(0, 10);

    m.books++;

    totalBooks++;

    calculateSignal(m);
}


function calculateSignal(m) {

    let score = 50;


    const volume =
        m.buyVolume +
        m.sellVolume;


    if (volume > 0) {

        m.pressure =
            m.buyVolume /
            volume *
            100;

        score +=
            (m.pressure - 50) *
            0.45;
    }


    if (m.prices.length >= 2) {

        const first =
            m.prices[0].price;

        const last =
            m.prices[
                m.prices.length - 1
            ].price;

        if (first > 0) {

            m.momentum =
                (
                    (last - first) /
                    first
                ) * 100;

            score +=
                m.momentum * 7;
        }
    }


    let bidVolume = 0;
    let askVolume = 0;


    m.bids.forEach(x => {

        bidVolume +=
            Number(x[1]);

    });


    m.asks.forEach(x => {

        askVolume +=
            Number(x[1]);

    });


    if (
        bidVolume +
        askVolume >
        0
    ) {

        const bookPressure =
            bidVolume /
            (
                bidVolume +
                askVolume
            ) *
            100;

        score +=
            (
                bookPressure - 50
            ) * 0.25;
    }


    m.score =
        Math.max(
            0,
            Math.min(
                100,
                score
            )
        );


    if (m.score >= 80) {

        m.signal =
            "STRONG BUY";

    } else if (m.score >= 65) {

        m.signal =
            "BUY";

    } else if (m.score <= 20) {

        m.signal =
            "STRONG SELL";

    } else if (m.score <= 35) {

        m.signal =
            "SELL";

    } else {

        m.signal =
            "WAIT";
    }
}


function updateCounters() {

    const active =
        Object.values(market)
            .filter(
                m => m.price > 0
            )
            .length;


    setText(
        "activeCoins",
        active
    );


    setText(
        "totalMessages",
        totalMessages
    );


    setText(
        "totalTrades",
        totalTrades
    );


    setText(
        "totalBooks",
        totalBooks
    );


    renderTable();


    showDebug(
        "APP.JS ÇALIŞIYOR | " +
        "WebSocket: AKTİF | " +
        "Mesaj: " +
        totalMessages +
        " | Coin: " +
        active
    );
}


function renderTable() {

    const table =
        document.querySelector(
            "#coinTable tbody"
        );

    if (!table) return;

    table.innerHTML = "";


    Object.entries(market)
        .sort(
            (a, b) =>
                b[1].score -
                a[1].score
        )
        .forEach(
            ([symbol, m]) => {

                const row =
                    document.createElement(
                        "tr"
                    );


                row.innerHTML = `
                    <td>
                        ${symbol.replace(
                            "USDT",
                            ""
                        )}
                    </td>

                    <td>
                        ${priceFormat(
                            m.price
                        )}
                    </td>

                    <td>
                        ${
                            m.momentum >= 0
                                ? "+"
                                : ""
                        }${m.momentum.toFixed(3)}%
                    </td>

                    <td>
                        ${m.signal}
                    </td>

                    <td>
                        ${m.score.toFixed(1)}
                    </td>

                    <td>
                        ${m.pressure.toFixed(1)}%
                    </td>

                    <td>
                        ${m.trades}
                    </td>
                `;


                table.appendChild(row);
            }
        );
}


function start() {

    console.log(
        "APP.JS V5 BAŞLADI"
    );

    setConnection(
        "Bağlanıyor..."
    );

    connect();

    setInterval(
        updateCounters,
        500
    );
}


if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        start
    );

} else {

    start();
}
