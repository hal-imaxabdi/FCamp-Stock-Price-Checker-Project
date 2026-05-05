'use strict';

const fetch = require('node-fetch');
const crypto = require('crypto');
const mongoose = require('mongoose');

// ✅ Stock Schema - stores symbol + likes array of anonymized IPs
const stockSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true, uppercase: true },
  likes: { type: [String], default: [] }
});

const Stock = mongoose.model('Stock', stockSchema);

// ✅ Anonymize IP before saving (hash it for privacy)
function anonymizeIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// ✅ Fetch stock price from freeCodeCamp proxy
async function getStockPrice(symbol) {
  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`;
  const res = await fetch(url);
  const data = await res.json();
  return {
    stock: symbol.toUpperCase(),
    price: data.latestPrice
  };
}

module.exports = function(app) {

  app.route('/api/stock-prices')
    .get(async function(req, res) {
      try {
        let { stock, like } = req.query;
        const likeIt = like === 'true';

        // ✅ Get user IP and anonymize it
        const rawIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const anonIP = anonymizeIP(rawIP);

        // --- Single stock ---
        if (typeof stock === 'string') {
          const symbol = stock.toUpperCase();

          // Fetch price
          const { price } = await getStockPrice(symbol);

          // Find or create stock doc in DB
          let stockDoc = await Stock.findOne({ symbol });
          if (!stockDoc) {
            stockDoc = new Stock({ symbol, likes: [] });
          }

          // Add like if requested and not already liked
          if (likeIt && !stockDoc.likes.includes(anonIP)) {
            stockDoc.likes.push(anonIP);
          }

          await stockDoc.save();

          return res.json({
            stockData: {
              stock: symbol,
              price: price,
              likes: stockDoc.likes.length
            }
          });
        }

        // --- Two stocks ---
        if (Array.isArray(stock) && stock.length === 2) {
          const [sym1, sym2] = stock.map(s => s.toUpperCase());

          // Fetch both prices in parallel
          const [data1, data2] = await Promise.all([
            getStockPrice(sym1),
            getStockPrice(sym2)
          ]);

          // Find or create both docs
          let [doc1, doc2] = await Promise.all([
            Stock.findOne({ symbol: sym1 }),
            Stock.findOne({ symbol: sym2 })
          ]);

          if (!doc1) doc1 = new Stock({ symbol: sym1, likes: [] });
          if (!doc2) doc2 = new Stock({ symbol: sym2, likes: [] });

          // Add likes if requested
          if (likeIt) {
            if (!doc1.likes.includes(anonIP)) doc1.likes.push(anonIP);
            if (!doc2.likes.includes(anonIP)) doc2.likes.push(anonIP);
          }

          await Promise.all([doc1.save(), doc2.save()]);

          const rel1 = doc1.likes.length - doc2.likes.length;
          const rel2 = doc2.likes.length - doc1.likes.length;

          return res.json({
            stockData: [
              { stock: sym1, price: data1.price, rel_likes: rel1 },
              { stock: sym2, price: data2.price, rel_likes: rel2 }
            ]
          });
        }

        // Bad request
        return res.status(400).json({ error: 'Invalid stock query' });

      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }
    });
};