export interface Env {
	DB: D1Database;
}

interface OrderRequest {
	user_id: string;
	item_id: string;
	quantity: number;
	household_size?: number;
	unit?: string;
}

interface Pattern {
	user_id: string;
	item_id: string;
	average_cycle: number;
	last_purchase_date: number;
	last_quantity: number;
	data_points: number;
	confidence_score: number;
}

const DEFAULT_CYCLES: Record<string, number> = {
	"milk": 5, // 5 days per liter for a standard household
	"water": 2,
	"egg": 7,
	"detergent": 30,
	"default": 14
};

const ALPHA = 0.3; // Smoothing factor for EMA

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// CORS headers
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			if (path === "/v1/log-order" && request.method === "POST") {
				return await handleLogOrder(request, env, corsHeaders);
			}

			if (path === "/v1/predict" && request.method === "GET") {
				return await handlePredict(url, env, corsHeaders);
			}

			if (path === "/" || path === "/index.html") {
				return new Response(renderLandingPage(), {
					headers: { ...corsHeaders, "Content-Type": "text/html" },
				});
			}

			return new Response("Not Found", { status: 404, headers: corsHeaders });
		} catch (error: any) {
			return new Response(JSON.stringify({ error: error.message }), {
				status: 500,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			});
		}
	},
};

async function handleLogOrder(request: Request, env: Env, headers: any): Promise<Response> {
	const body: OrderRequest = await request.json();
	const { user_id, item_id, quantity, household_size = 1, unit = "unit" } = body;
	const now = Math.floor(Date.now() / 1000);

	// 1. Get existing pattern
	const existing = await env.DB.prepare(
		"SELECT * FROM patterns WHERE user_id = ? AND item_id = ?"
	).bind(user_id, item_id).first<Pattern>();

	let new_average: number;
	let data_points = 1;
	let confidence_score = 0.3;

	if (existing) {
		// 2. Calculate actual cycle since last purchase
		// actual_cycle = (days passed) / (quantity of LAST purchase)
		const daysPassed = (now - existing.last_purchase_date) / (24 * 60 * 60);
		const actual_cycle = daysPassed / existing.last_quantity;

		// 3. EMA update
		new_average = (ALPHA * actual_cycle) + ((1 - ALPHA) * existing.average_cycle);
		data_points = existing.data_points + 1;
		confidence_score = Math.min(0.95, existing.confidence_score + 0.1);

		// Update pattern
		await env.DB.prepare(
			"UPDATE patterns SET average_cycle = ?, last_purchase_date = ?, last_quantity = ?, data_points = ?, confidence_score = ? WHERE user_id = ? AND item_id = ?"
		).bind(new_average, now, quantity, data_points, confidence_score, user_id, item_id).run();
	} else {
		// Cold start: estimate based on household size or default
		const baseCycle = DEFAULT_CYCLES[item_id.toLowerCase()] || DEFAULT_CYCLES["default"];
		new_average = baseCycle / household_size;
		
		// Insert new pattern
		await env.DB.prepare(
			"INSERT INTO patterns (user_id, item_id, average_cycle, last_purchase_date, last_quantity, data_points, confidence_score) VALUES (?, ?, ?, ?, ?, ?, ?)"
		).bind(user_id, item_id, new_average, now, quantity, data_points, confidence_score).run();
	}

	// 4. Log the order for history
	await env.DB.prepare(
		"INSERT INTO orders (user_id, item_id, order_date, quantity, household_size, unit) VALUES (?, ?, ?, ?, ?, ?)"
	).bind(user_id, item_id, now, quantity, household_size, unit).run();

	return new Response(JSON.stringify({ 
		success: true, 
		message: "Order logged and pattern updated",
		next_prediction_days: Math.round(new_average * quantity)
	}), {
		headers: { ...headers, "Content-Type": "application/json" },
	});
}

async function handlePredict(url: URL, env: Env, headers: any): Promise<Response> {
	const user_id = url.searchParams.get("user_id");
	const item_id = url.searchParams.get("item_id");

	if (!user_id || !item_id) {
		return new Response(JSON.stringify({ error: "Missing user_id or item_id" }), {
			status: 400,
			headers: { ...headers, "Content-Type": "application/json" },
		});
	}

	const pattern = await env.DB.prepare(
		"SELECT * FROM patterns WHERE user_id = ? AND item_id = ?"
	).bind(user_id, item_id).first<Pattern>();

	if (!pattern) {
		return new Response(JSON.stringify({ error: "No historical data for this item" }), {
			status: 404,
			headers: { ...headers, "Content-Type": "application/json" },
		});
	}

	const now = Math.floor(Date.now() / 1000);
	const total_expected_days = pattern.average_cycle * pattern.last_quantity;
	const expected_exhaustion_date = pattern.last_purchase_date + (total_expected_days * 24 * 60 * 60);
	
	const seconds_remaining = expected_exhaustion_date - now;
	const days_remaining = Math.max(0, Math.floor(seconds_remaining / (24 * 60 * 60)));
	
	const confidence_level = pattern.confidence_score > 0.8 ? "high" : pattern.confidence_score > 0.5 ? "medium" : "low";

	return new Response(JSON.stringify({
		item_id: pattern.item_id,
		expected_exhaustion_date: new Date(expected_exhaustion_date * 1000).toISOString().split('T')[0],
		days_remaining,
		confidence_level,
		trigger_notification: days_remaining <= 1,
		stats: {
			average_cycle_per_unit: pattern.average_cycle,
			last_quantity: pattern.last_quantity,
			data_points: pattern.data_points
		}
	}), {
		headers: { ...headers, "Content-Type": "application/json" },
	});
}

function renderLandingPage(): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PRF API | Predictive Reorder Forecasting</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #ec4899;
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.7);
            --text: #f8fafc;
            --text-dim: #94a3b8;
            --accent: #10b981;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', sans-serif;
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.6;
            overflow-x: hidden;
        }

        h1, h2, h3 {
            font-family: 'Outfit', sans-serif;
            font-weight: 800;
        }

        .container {
            max-width: 1100px;
            margin: 0 auto;
            padding: 0 2rem;
        }

        /* Hero Section */
        header {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            background: radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.15) 0%, rgba(15, 23, 42, 0) 70%);
            position: relative;
        }

        .badge {
            background: rgba(99, 102, 241, 0.1);
            color: var(--primary);
            padding: 0.5rem 1rem;
            border-radius: 99px;
            font-size: 0.875rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            border: 1px solid rgba(99, 102, 241, 0.2);
            display: inline-block;
        }

        h1 {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            background: linear-gradient(to right, #fff, #94a3b8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.02em;
        }

        .hero-desc {
            font-size: 1.25rem;
            color: var(--text-dim);
            max-width: 700px;
            margin-bottom: 3rem;
        }

        .cta-group {
            display: flex;
            gap: 1rem;
        }

        .btn {
            padding: 0.8rem 2rem;
            border-radius: 12px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.3s ease;
            cursor: pointer;
        }

        .btn-primary {
            background: var(--primary);
            color: white;
            box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
        }

        .btn-primary:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.05);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        /* Features */
        .features {
            padding: 8rem 0;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }

        .card {
            background: var(--card-bg);
            padding: 2.5rem;
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            transition: transform 0.3s ease;
        }

        .card:hover {
            transform: translateY(-5px);
            border-color: rgba(99, 102, 241, 0.3);
        }

        .icon {
            width: 48px;
            height: 48px;
            background: rgba(99, 102, 241, 0.1);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1.5rem;
            color: var(--primary);
        }

        .card h3 {
            margin-bottom: 1rem;
            font-size: 1.5rem;
        }

        .card p {
            color: var(--text-dim);
        }

        /* Code Block */
        .code-section {
            padding-bottom: 8rem;
        }

        .code-window {
            background: #000;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }

        .code-header {
            background: #1e293b;
            padding: 0.75rem 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .dot { width: 12px; height: 12px; border-radius: 50%; }
        .dot.red { background: #ff5f56; }
        .dot.yellow { background: #ffbd2e; }
        .dot.green { background: #27c93f; }

        pre {
            padding: 2rem;
            font-family: 'Fira Code', monospace;
            font-size: 0.9rem;
            color: #d1d5db;
            overflow-x: auto;
        }

        .string { color: var(--accent); }
        .key { color: var(--secondary); }
        .number { color: #f59e0b; }

        footer {
            padding: 4rem 0;
            text-align: center;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            color: var(--text-dim);
            font-size: 0.875rem;
        }

        /* Animations */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .animate {
            animation: fadeIn 0.8s ease forwards;
        }

        .delay-1 { animation-delay: 0.2s; }
        .delay-2 { animation-delay: 0.4s; }

        /* Simulator Styles */
        .simulator-section {
            padding: 8rem 0;
            background: rgba(15, 23, 42, 0.5);
            border-radius: 32px;
            margin: 4rem 0;
            border: 1px solid rgba(99, 102, 241, 0.1);
        }

        .sim-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4rem;
            align-items: center;
        }

        .sim-controls {
            background: var(--card-bg);
            padding: 2rem;
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .sim-input-group {
            margin-bottom: 1.5rem;
        }

        .sim-input-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-size: 0.875rem;
            color: var(--text-dim);
        }

        .sim-input {
            width: 100%;
            padding: 0.75rem;
            background: rgba(0,0,0,0.2);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            color: white;
            font-family: inherit;
        }

        .sim-status {
            text-align: center;
            padding: 2rem;
            background: rgba(99, 102, 241, 0.05);
            border-radius: 20px;
            border: 2px dashed rgba(99, 102, 241, 0.2);
        }

        .stock-indicator {
            font-size: 3rem;
            margin-bottom: 1rem;
        }

        .prediction-result {
            margin-top: 1.5rem;
            padding: 1rem;
            background: rgba(16, 185, 129, 0.1);
            border-radius: 12px;
            border: 1px solid rgba(16, 185, 129, 0.2);
            display: none;
        }

        @media (max-width: 768px) {
            h1 { font-size: 2.5rem; }
            .cta-group { flex-direction: column; width: 100%; }
            .btn { text-align: center; }
            .sim-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <header>
        <div class="container animate">
            <span class="badge">Zero-cost Prediction API</span>
            <h1>Predictive Reorder Forecasting</h1>
            <p class="hero-desc">The intelligent, statistical API that tells you when your users will run out of essentials. No expensive AI tokens, just pure math on the edge.</p>
            <div class="cta-group">
                <a href="#simulator" class="btn btn-primary">Try Live Demo</a>
                <a href="#docs" class="btn btn-secondary">View Documentation</a>
            </div>
        </div>
    </header>

    <div class="container">
        <section id="simulator" class="simulator-section animate delay-1">
            <div style="text-align: center; margin-bottom: 3rem;">
                <h2 style="font-size: 2.5rem; margin-bottom: 1rem;">Algorithm Simulator</h2>
                <p style="color: var(--text-dim);">Experience the EMA algorithm adapting to your purchase habits in real-time.</p>
            </div>
            
            <div class="sim-grid">
                <div class="sim-controls">
                    <div class="sim-input-group">
                        <label>Item Name</label>
                        <input type="text" id="sim-item" class="sim-input" value="Milk">
                    </div>
                    <div class="sim-input-group">
                        <label>Quantity (Liters/Units)</label>
                        <input type="number" id="sim-qty" class="sim-input" value="2">
                    </div>
                    <div class="sim-input-group">
                        <label>Household Size</label>
                        <input type="number" id="sim-size" class="sim-input" value="2">
                    </div>
                    <button id="btn-log" class="btn btn-primary" style="width: 100%;">Log Purchase</button>
                    <button id="btn-predict" class="btn btn-secondary" style="width: 100%; margin-top: 1rem;">Get Prediction</button>
                </div>

                <div class="sim-status" id="sim-status-box">
                    <div class="stock-indicator">🥛</div>
                    <h3 id="sim-message">Ready to Predict</h3>
                    <p id="sim-submessage" style="color: var(--text-dim);">Log your first purchase to start the model.</p>
                    
                    <div id="prediction-box" class="prediction-result">
                        <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.5rem; opacity: 0.7;">Next Exhaustion Date</div>
                        <div id="pred-date" style="font-size: 1.5rem; font-weight: 800; color: var(--accent);">2026-05-15</div>
                        <div id="pred-days" style="font-size: 0.9rem; margin-top: 0.5rem;">4 days remaining</div>
                    </div>
                </div>
            </div>
        </section>

        <section class="features">
            <div class="card animate delay-1">
                <div class="icon">📈</div>
                <h3>EMA Algorithm</h3>
                <p>Uses Exponential Moving Average to weight recent consumption patterns more heavily, adapting to lifestyle changes instantly.</p>
            </div>
            <div class="card animate delay-1">
                <div class="icon">⚡</div>
                <h3>Edge Compute</h3>
                <p>Runs on Cloudflare Workers for global low-latency performance with zero cold starts and 0ms infrastructure overhead.</p>
            </div>
            <div class="card animate delay-1">
                <div class="icon">💸</div>
                <h3>Zero Cost</h3>
                <p>Leverages Cloudflare D1 and Workers free tier. Scale to millions of predictions without breaking the bank.</p>
            </div>
        </section>

        <section id="docs" class="code-section animate delay-2">
            <h2 style="margin-bottom: 2rem; font-size: 2.5rem;">API Reference</h2>
            
            <h3 style="margin-bottom: 1rem; color: var(--primary);">POST /v1/log-order</h3>
            <div class="code-window" style="margin-bottom: 3rem;">
                <div class="code-header">
                    <div class="dot red"></div>
                    <div class="dot yellow"></div>
                    <div class="dot green"></div>
                    <span style="margin-left: 1rem; font-size: 0.8rem; opacity: 0.5;">Request Body</span>
                </div>
                <pre>
{
  <span class="key">"user_id"</span>: <span class="string">"user_123"</span>,
  <span class="key">"item_id"</span>: <span class="string">"milk_001"</span>,
  <span class="key">"quantity"</span>: <span class="number">2</span>,
  <span class="key">"household_size"</span>: <span class="number">3</span>,
  <span class="key">"unit"</span>: <span class="string">"liter"</span>
}</pre>
            </div>

            <h3 style="margin-bottom: 1rem; color: var(--primary);">GET /v1/predict</h3>
            <div class="code-window">
                <div class="code-header">
                    <div class="dot red"></div>
                    <div class="dot yellow"></div>
                    <div class="dot green"></div>
                    <span style="margin-left: 1rem; font-size: 0.8rem; opacity: 0.5;">Response JSON</span>
                </div>
                <pre>
{
  <span class="key">"item_id"</span>: <span class="string">"milk_001"</span>,
  <span class="key">"expected_exhaustion_date"</span>: <span class="string">"2026-05-15"</span>,
  <span class="key">"days_remaining"</span>: <span class="number">4</span>,
  <span class="key">"confidence_level"</span>: <span class="string">"high"</span>,
  <span class="key">"trigger_notification"</span>: <span class="number">true</span>
}</pre>
            </div>
        </section>
    </div>

    <footer>
        <div class="container">
            <p>&copy; 2026 Predictive Reorder Forecasting (PRF) API. Built with Cloudflare Workers & D1.</p>
        </div>
    </footer>

    <script>
        const userId = 'sim_user_' + Math.random().toString(36).substr(2, 9);
        
        document.getElementById('btn-log').addEventListener('click', async () => {
            const item = document.getElementById('sim-item').value;
            const qty = parseFloat(document.getElementById('sim-qty').value);
            const size = parseInt(document.getElementById('sim-size').value);
            
            try {
                const res = await fetch('/v1/log-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user_id: userId,
                        item_id: item,
                        quantity: qty,
                        household_size: size
                    })
                });
                const data = await res.json();
                
                document.getElementById('sim-message').innerText = 'Order Logged!';
                document.getElementById('sim-submessage').innerText = 'Prediction updated based on EMA algorithm.';
                
                // Auto predict after log
                setTimeout(getPrediction, 500);
            } catch (err) {
                alert('Error logging order. Make sure the worker is running.');
            }
        });

        document.getElementById('btn-predict').addEventListener('click', getPrediction);

        async function getPrediction() {
            const item = document.getElementById('sim-item').value;
            try {
                const res = await fetch(\`/v1/predict?user_id=\${userId}&item_id=\${item}\`);
                const data = await res.json();
                
                if (data.error) {
                    document.getElementById('sim-message').innerText = 'Not Enough Data';
                    return;
                }

                document.getElementById('prediction-box').style.display = 'block';
                document.getElementById('pred-date').innerText = data.expected_exhaustion_date;
                document.getElementById('pred-days').innerText = data.days_remaining + ' days remaining';
                
                if (data.trigger_notification) {
                    document.getElementById('sim-status-box').style.borderColor = 'var(--secondary)';
                    document.getElementById('sim-message').innerText = '⚠️ Reorder Soon!';
                } else {
                    document.getElementById('sim-status-box').style.borderColor = 'rgba(16, 185, 129, 0.5)';
                    document.getElementById('sim-message').innerText = 'Stock Healthy';
                }
            } catch (err) {
                console.error(err);
            }
        }
    </script>
</body>
</html>
	`;
}
