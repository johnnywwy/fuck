/**
 * ChartRenderer - 渲染逻辑层
 */
const ChartRenderer = {
  // 生成 MarkArea 和 MarkLine 数据
  generateMarkings(pivots) {
    const areas = [];
    const lines = [];
    for (let i = 0; i < pivots.length - 1; i++) {
      const start = pivots[i],
        end = pivots[i + 1];
      areas.push([
        {
          xAxis: start.index,
          label: {
            show: true,
            position: ["50%", "10%"],
            formatter: `${end.index - start.index}d`,
            color: "#333",
            fontSize: 11,
            fontWeight: "bold",
            backgroundColor: "rgba(255,255,255,0.8)",
            padding: [2, 4],
            borderRadius: 4,
          },
          itemStyle: {
            color: i % 2 === 0 ? "rgba(0,0,0,0.02)" : "transparent",
          },
        },
        { xAxis: end.index },
      ]);
      lines.push({ xAxis: start.index });
    }
    if (pivots.length > 0)
      lines.push({ xAxis: pivots[pivots.length - 1].index });
    return { areas, lines };
  },

  // 获取基础 Option 配置
  getOption(data, pivots, yType, yRange) {
    return {
      animation: false,
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      grid: {
        left: "40px",
        right: "70px",
        top: "40px",
        bottom: "15%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: data.map((d) => d.fullDate),
        boundaryGap: true, // 开启边距，防止第一根 K 线贴边
      },
      yAxis: {
        type: yType,
        scale: true,
        position: "right",
        min: yRange.min,
        max: yRange.max,
        splitLine: { show: true, lineStyle: { color: "#eee" } },
      },
      dataZoom: [
        {
          type: "inside",
          filterMode: "empty", // 改为 empty，防止拉伸 Y 轴时数据被过滤掉
          moveOnMouseMove: true, // 允许按住鼠标中键或特定组合键拖动
          preventDefaultMouseMove: false,
        },
        {
          type: "slider",
          bottom: "5%",
          filterMode: "empty",
        },
      ],
      series: [
        {
          name: "K线",
          type: "candlestick",
          data: data.map((d) => [d.open, d.close, d.low, d.high]),
          itemStyle: {
            color: "#52c41a",
            color0: "#f5222d",
            borderColor: "#52c41a",
            borderColor0: "#f5222d",
          },
        },
        {
          name: "波段",
          type: "line",
          data: pivots.map((p) => [p.index, p.price]),
          lineStyle: { color: "#ff9800", width: 2 },
          symbol: "circle",
          symbolSize: 8,
          z: 10, // 确保线在 K 线上面
        },
      ],
    };
  },
};
