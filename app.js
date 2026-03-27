// --- 1. 图表与交互控制器 ---
class ChartController {
    constructor(containerId, onZoomCallback) {
        this.chart = echarts.init(document.getElementById(containerId));
        this.state = { yType: "value", yRange: { min: null, max: null }, isDragging: false };
        this.onZoomCallback = onZoomCallback;
        this.bindEvents();
    }

    render(data, pivots) {
        const option = {
            animation: false,
            grid: { left: "30px", right: "60px", top: "30px", bottom: "60px", containLabel: true },
            xAxis: { type: "category", data: data.map((d) => d.fullDate), boundaryGap: false, axisLine: { lineStyle: { color: "#ccc" } } },
            yAxis: { type: this.state.yType, scale: true, position: "right", min: this.state.yRange.min, max: this.state.yRange.max, axisLine: { show: false }, splitLine: { lineStyle: { type: "dashed", color: "#eee" } } },
            dataZoom: [{ type: "inside", filterMode: "empty" }, { type: "slider", filterMode: "empty", bottom: 10, height: 20 }],
            series: [
                { name: "K线", type: "candlestick", data: data.map((d) => [d.open, d.close, d.low, d.high]), itemStyle: { color: "#52c41a", color0: "#f5222d", borderColor: "#52c41a", borderColor0: "#f5222d" } },
                { name: "波段", type: "line", data: pivots.map((p) => [p.index, p.price]), lineStyle: { color: "#ff9800", width: 2.5 }, symbol: "circle", symbolSize: 6, z: 10 }
            ],
        };
        this.chart.setOption(option, true);
        this.onZoomCallback(); // 初始化后触发一次回调同步其他面板
    }

    updateScale(type) {
        this.state.yType = type;
        this.state.yRange = { min: null, max: null };
        this.chart.setOption({ yAxis: { type: this.state.yType, min: null, max: null } });
    }

    zoomToRange(startIndex, endIndex) {
        this.state.yRange = { min: null, max: null };
        this.chart.dispatchAction({ type: "dataZoom", startValue: startIndex, endValue: endIndex });
    }

    getVisibleRange() {
        const axis = this.chart.getModel().getComponent("xAxis", 0).axis;
        return axis.getExtent().map((v) => Math.round(axis.coordToData(v)));
    }

    bindEvents() {
        this.chart.on("dataZoom", () => this.onZoomCallback());
        window.addEventListener("resize", () => this.chart.resize());

        // Y轴拖拽交互
        const zr = this.chart.getZr();
        zr.on("mousedown", (e) => {
            if (e.offsetX > this.chart.getWidth() - 60) {
                this.state.isDragging = true;
                this.lastY = e.offsetY;
            }
        });
        zr.on("mousemove", (e) => {
            if (!this.state.isDragging) return;
            const axis = this.chart.getModel().getComponent("yAxis", 0).axis;
            const extent = axis.scale.getExtent();
            const range = extent[1] - extent[0];
            const delta = (range / 400) * (e.offsetY - this.lastY);
            this.state.yRange.min = (this.state.yRange.min || extent[0]) - delta;
            this.state.yRange.max = (this.state.yRange.max || extent[1]) + delta;
            this.lastY = e.offsetY;
            this.chart.setOption({ yAxis: { min: this.state.yRange.min, max: this.state.yRange.max } });
        });
        zr.on("mouseup", () => (this.state.isDragging = false));
        zr.on("dblclick", (e) => {
            if (e.offsetX > this.chart.getWidth() - 60) {
                this.state.yRange = { min: null, max: null };
                this.chart.setOption({ yAxis: { min: null, max: null } });
            }
        });
    }
}

// --- 2. 傅里叶分析引擎 ---
class FFTAnalyzer {
    static render(pivots, containerId) {
        if (pivots.length < 6) return;
        const n = 512, signal = new Float64Array(n).fill(0);
        const start = pivots[0].index, end = pivots[pivots.length - 1].index;
        const totalDays = end - start;

        pivots.forEach((p, i) => {
            if (i > 0) {
                const t = Math.min(n - 1, p.index - start);
                signal[t] = Math.abs(p.price - pivots[i - 1].price);
            }
        });

        let spectrum = [];
        for (let k = 2; k < n / 2; k++) {
            let re = 0, im = 0;
            for (let t = 0; t < n; t++) {
                let a = (2 * Math.PI * k * t) / n;
                re += signal[t] * Math.cos(a);
                im -= signal[t] * Math.sin(a);
            }
            let period = Math.round(n / k), amp = Math.sqrt(re * re + im * im);
            let occurrences = (totalDays / period).toFixed(1);
            if (period >= 3 && period <= 180) spectrum.push({ period, amp, occurrences });
        }

        const tops = spectrum.sort((a, b) => b.amp - a.amp).filter((v, i, a) => a.findIndex((t) => t.period === v.period) === i).slice(0, 5);
        if (!tops.length) return;

        const maxAmp = tops[0].amp;
        document.getElementById(containerId).innerHTML = tops.map((t) => {
            const strength = ((t.amp / maxAmp) * 100).toFixed(0);
            return `
        <div class="fft-card" style="border-left: 5px solid #ff4d4f; min-width:130px; background:#fff; padding:10px;">
          <div style="font-size: 11px; color: #888; margin-bottom:2px;">主导频率</div>
          <div style="font-size: 20px; font-weight: 900; color: #111;">${t.period} <small style="font-size:12px;">天/次</small></div>
          <div style="margin-top:8px; font-size:12px; color:#f5222d;">🔄 重复了 <b>${t.occurrences}</b> 轮</div>
          <div style="margin-top:4px; font-size:11px; color:#666;">能量强度: ${Math.round(t.amp)}</div>
          <div style="width:100%; height:3px; background:#eee; margin-top:6px;">
            <div style="width:${strength}%; height:100%; background:#ff4d4f;"></div>
          </div>
        </div>`;
        }).join("");
    }
}

// --- 3. 江恩网格渲染器 ---
class GannRenderer {
    constructor(displayId, wrapId) {
        this.displayEl = document.getElementById(displayId);
        this.wrapEl = document.getElementById(wrapId);
        this.anchor = new Date(2023, 0, 1);
        this.layers = 13;
        this.holidays = [
            "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29", "2023-06-19", "2023-07-04", "2023-09-04", "2023-11-23", "2023-12-25",
            "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
            "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
            "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"
        ];
    }

    // 新增：根据选中的年份动态更新锚点
    updateAnchor(selectedYears, allData) {
        if (!selectedYears || selectedYears.length === 0) {
            this.layers = 13;
            this.anchor = new Date(2023, 0, 1);
        } else {
            const years = selectedYears.map(y => parseInt(y));
            const minYear = Math.min(...years);
            const maxYear = Math.max(...years);
            this.anchor = new Date(minYear, 0, 1);

            // 计算从起点到终点总共多少天
            // 比如 2023 到 2025 年底，大约 1095 天
            const lastDate = new Date(maxYear, 11, 31);
            const totalDays = Math.ceil((lastDate - this.anchor) / (1000 * 60 * 60 * 24)) + 1;

            // 根据天数反推螺旋层数： (2 * layers + 1)^2 >= totalDays
            // layers >= (sqrt(totalDays) - 1) / 2
            this.layers = Math.ceil((Math.sqrt(totalDays) - 1) / 2) + 1;

            // 给个保底，至少 13 层，最多给个 40 层防止卡死
            this.layers = Math.max(13, Math.min(this.layers, 45));
        }

        console.log(`动态扩容：当前层数 ${this.layers}，起始年份 ${this.anchor.getFullYear()}`);
        this.initSpiral();
    }

    isMarketClosed(dateStr, dateObj) {
        const day = dateObj.getDay();
        return day === 0 || day === 6 || this.holidays.includes(dateStr);
    }

    initSpiral() {
        // 计算边长 S (奇数)
        const S = (this.layers * 2) + 1;
        const m = Array(S).fill().map(() => Array(S).fill(0));
        const mid = Math.floor(S / 2);

        // 螺旋算法填充矩阵 (从中心 1 开始向外扩散)
        let x = mid, y = mid, val = 1, step = 1;
        m[y][x] = val;
        while (val < S * S) {
            // 左 -> 上 -> 右 -> 下 的螺旋路径
            for (let i = 0; i < step && val < S * S; i++) { x--; if (x >= 0 && x < S) m[y][x] = ++val; }
            for (let i = 0; i < step && val < S * S; i++) { y--; if (y >= 0 && y < S) m[y][x] = ++val; }
            step++;
            for (let i = 0; i < step && val < S * S; i++) { x++; if (x >= 0 && x < S) m[y][x] = ++val; }
            for (let i = 0; i < step && val < S * S; i++) { y++; if (y >= 0 && y < S) m[y][x] = ++val; }
            step++;
        }

        // 构建 HTML 表格
        let h = `<table class="gann-table" id="gannTable" style="border: 2px solid #333;">`;
        for (let r = 0; r < S; r++) {
            h += "<tr>";
            for (let c = 0; c < S; c++) {
                const v = m[r][c];
                // 计算该单元格对应的真实日期
                const d = new Date(this.anchor);
                d.setDate(d.getDate() + (v - 1));

                const fStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

                // 计算样式类
                const layer = Math.max(Math.abs(r - mid), Math.abs(c - mid));
                const layerClass = (layer % 2 === 0) ? "g-layer-even" : "g-layer-odd";
                const closedClass = this.isMarketClosed(fStr, d) ? "g-holiday" : "";

                let cls = `g-cell ${layerClass} ${closedClass}`;
                if (v === 1) cls += " g-center";
                // 绘制对角线和十字线
                if (r === c || r + c === S - 1 || r === mid || c === mid) cls += " g-diag";

                h += `<td class="${cls}" data-d="${fStr}" title="${fStr}${closedClass ? ' (休市)' : ''}">
                        <div class="c-box">
                          <span class="c-date">${d.getMonth() + 1}/${d.getDate()}</span>
                          <span class="c-num">${v}</span>
                        </div>
                      </td>`;
            }
            h += "</tr>";
        }

        // 渲染到页面
        this.displayEl.innerHTML = h + "</table>";

        // 如果格子太多，自动缩小字体以免撑开
        if (S > 35) {
            this.displayEl.classList.add('mini-grid');
        } else {
            this.displayEl.classList.remove('mini-grid');
        }
    }

    // 修改 GannRenderer 类的 paint 方法
    paint(allPivots, allData, selectedYears = []) {
        // 第一步：清空当前九方图所有点的状态（这是必须的，因为 DOM 重绘了）
        const cells = document.querySelectorAll(".g-cell");
        cells.forEach(c => {
            c.classList.remove("year-active", "g-peak", "g-valley");
            const classes = Array.from(c.classList).filter(cls => cls.startsWith('y-20'));
            c.classList.remove(...classes);
        });

        if (selectedYears.length === 0) return;

        // 第二步：从全量转折点中，筛选出属于“已勾选年份”的所有点
        const pMap = {};
        allPivots.forEach(p => {
            const dInfo = allData[p.index];
            if (dInfo && selectedYears.includes(dInfo.year.toString())) {
                pMap[dInfo.fullDate] = { type: p.type, year: dInfo.year };
            }
        });

        // 第三步：遍历 DOM 染色
        cells.forEach(c => {
            const d = c.getAttribute("data-d");
            const match = pMap[d];
            if (match) {
                c.classList.add("year-active");
                c.classList.add(`y-${match.year}`); // 区分年份边框
                if (match.type === "Peak") {
                    c.classList.add("g-peak");   // 上涨变红
                } else if (match.type === "Valley") {
                    c.classList.add("g-valley"); // 下跌变绿
                }
            }
        });
    }

    updateSize(sizePx) {
        document.documentElement.style.setProperty("--g-size", sizePx + "px");
        document.getElementById("gLabel").innerText = sizePx + "px";
        const t = document.getElementById("gannTable");
        if (t) sizePx < 22 ? t.classList.add("hide-text") : t.classList.remove("hide-text");
    }

    toggleHolidays(isHidden) {
        isHidden ? this.wrapEl.classList.add('hide-holiday') : this.wrapEl.classList.remove('hide-holiday');
    }
}

// --- 4. 统计报表UI渲染 ---
class UIBuilder {
    static renderTable(visiblePivots) {
        let tableHtml = "";
        for (let i = 1; i < visiblePivots.length; i++) {
            const curr = visiblePivots[i], prev = visiblePivots[i - 1];
            const diff = curr.price - prev.price;
            const pct = ((diff / prev.price) * 100).toFixed(2);
            tableHtml += `<tr><td class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "上涨" : "下跌"}</td><td>${prev.date} → ${curr.date}</td><td>${curr.index - prev.index}d</td><td>${prev.price.toFixed(2)} → ${curr.price.toFixed(2)}</td><td class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "+" : ""}${pct}%</td></tr>`;
        }
        document.getElementById("tableBody").innerHTML = tableHtml || "<tr><td colspan='5'>缩放图表以查看详细波段</td></tr>";
    }

    static renderFibonacci(visiblePivots) {
        const fib = KLineAnalyzer.analyzeFibonacci(visiblePivots);
        if (fib) {
            document.getElementById("fibProb").innerText = fib.prob + "%";
            const listHtml = fib.list.map((f) => {
                if (!f.tMatch && !f.rMatch) return "";
                return `<div class="fib-item"><div style="display:flex; justify-content:space-between; margin-bottom:5px;"><b style="font-size:13px;">${f.date}</b><span style="color:#888;">周期: ${f.days}天</span></div><div style="display:flex; gap:5px;">${f.tMatch ? `<span class="tag tag-t">时间序列: ${f.tMatch}d</span>` : ""}${f.rMatch ? `<span class="tag tag-r">黄金比率: ${f.rMatch}</span>` : ""}</div></div>`;
            }).join("");
            document.getElementById("fibList").innerHTML = listHtml || "<div style='color:#999; text-align:center;'>当前区间未匹配到规律</div>";
        }
    }

    static renderYearPicker(data, containerId) {
        const years = [...new Set(data.map((d) => d.year))].sort();
        const container = document.getElementById(containerId);
        // 默认不提供“全部”，因为现在是多选，点哪个亮哪个
        let html = "";
        years.forEach((y) => {
            html += `<button class="btn year-btn" data-year="${y}">${y}年</button>`;
        });
        container.innerHTML = html;
    }
}

// --- 5. 核心调度应用 ---
class TraderApp {
    constructor() {
        this.data = [];
        this.pivots = [];
        // 初始化子模块
        this.chart = new ChartController("main", () => this.syncAnalysis());
        this.gann = new GannRenderer("gannDisplay", "gannWrap");
        this.selectedYears = []; // 新增：记录选中的年份
    }

    async bootstrap() {
        try {
            const raw = await fetch("spy_3yr_data.json").then((r) => r.json());
            this.data = KLineAnalyzer.preprocess(raw);
            this.pivots = KLineAnalyzer.getPivots(this.data, 5);

            this.gann.initSpiral();
            UIBuilder.renderYearPicker(this.data, "yearPicker");
            this.chart.render(this.data, this.pivots); // 内部触发 syncAnalysis

            this.bindDOMDelegations();
        } catch (e) {
            console.error("数据加载或初始化失败:", e);
        }
    }

    // 修改 syncAnalysis，确保它调用 paint 时带上选中的年份
    syncAnalysis() {
        const [sIdx, eIdx] = this.chart.getVisibleRange();
        const visible = this.pivots
            .filter((p) => p.index >= sIdx && p.index <= eIdx)
            .map((p) => ({ ...p, date: this.data[p.index].fullDate }));

        UIBuilder.renderTable(visible);
        UIBuilder.renderFibonacci(visible);
        // 关键改动：传入所有转折点和选中的年份
        this.gann.paint(this.pivots, this.data, this.selectedYears);
        FFTAnalyzer.render(visible, "fftResult");
    }

    // 处理全局DOM事件（使用事件委托）
    bindDOMDelegations() {
        // 轴类型切换
        document.getElementById("scaleGroup").addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON") {
                document.querySelectorAll("#scaleGroup .btn").forEach(b => b.classList.remove("active"));
                e.target.classList.add("active");
                this.chart.updateScale(e.target.dataset.type);
            }
        });

        // 年份区间切换
        // 在 TraderApp 的 bindDOMDelegations 内部修改
        document.getElementById("yearPicker").addEventListener("click", (e) => {
            if (e.target.classList.contains("year-btn")) {
                const year = e.target.dataset.year;
                const idx = this.selectedYears.indexOf(year);

                // 1. 更新多选状态数组
                if (idx > -1) {
                    this.selectedYears.splice(idx, 1);
                    e.target.classList.remove("active");
                } else {
                    this.selectedYears.push(year);
                    e.target.classList.add("active");
                }

                // 2. 核心：必须先重置原点（这步会刷新整个表格 DOM）
                this.gann.updateAnchor(this.selectedYears);

                // 3. 核心：传入 THIS.PIVOTS (全量转折点) 而不是 visiblePivots
                // 传入 THIS.DATA (全量数据)
                this.gann.paint(this.pivots, this.data, this.selectedYears);

                // 4. (可选) 如果你想让 K 线图也跳到选中的年份，才调用 zoomToRange
                // if (this.selectedYears.length > 0) {
                //    const lastYear = parseInt(this.selectedYears[this.selectedYears.length-1]);
                //    const sIdx = this.data.findIndex(d => d.year === lastYear);
                //    const eIdx = this.data.findLastIndex(d => d.year === lastYear);
                //    this.chart.zoomToRange(sIdx, eIdx);
                // }
            }
        });

        // 江恩螺旋大小滑动条
        document.getElementById("gannSizeSlider").addEventListener("input", (e) => {
            this.gann.updateSize(e.target.value);
        });

        // 休市透明化开关
        document.getElementById("gannHolidayToggle").addEventListener("change", (e) => {
            this.gann.toggleHolidays(e.target.checked);
        });
    }
}

// 启动应用
const app = new TraderApp();
app.bootstrap();