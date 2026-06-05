import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const ScatterHeatmap = ({ data, selectedKPI, title }) => {
    const chartRef = useRef(null);
    const chartInstance = useRef(null);

    useEffect(() => {
        if (!chartRef.current) return;

        // Initialize chart
        if (!chartInstance.current) {
            chartInstance.current = echarts.init(chartRef.current);
        }

        const option = {
            title: {
                text: title || '',
                textStyle: { color: 'rgba(255,255,255,0.8)', fontSize: 16 }
            },
            tooltip: {
                trigger: 'item',
                formatter: function (params) {
                    const data = params.data.value;
                    return `
                        <div style="padding: 5px;">
                            <strong>Table: ${data[16] || 'N/A'}</strong><br/>
                            Game: ${data[3] || 'N/A'}<br/>
                            ${selectedKPI}: ${params.data.kpiValue !== undefined ? params.data.kpiValue : 'N/A'}<br/>
                        </div>
                    `;
                }
            },
            xAxis: {
                show: false,
                type: 'value',
                min: 0,
                max: 1500, // adjust based on actual map coordinates
            },
            yAxis: {
                show: false,
                type: 'value',
                min: -1500, // adjust based on actual map coordinates
                max: 0,
                inverse: true
            },
            series: [{
                type: 'scatter',
                data: data.map(item => {
                    // Mapping based on output.js structure
                    // [x, y, r, game, path, sizeX, sizeY, dpod, wpod, hcpod, ohpod, dpoh, wpoh, hcpoh, tablelimit, avgbet, table, ...]
                    const r = item[2];
                    const path = item[4];
                    const sizeX = item[5];
                    const sizeY = item[6];
                    
                    // Determine which value matches the selectedKPI based on original logic.
                    // For simplicity, we just bind it to tooltip via passing `item`
                    // In a real port, we need the logic that maps selectedKPI to the specific index.
                    // Let's assume the Dashboard passes item.color and item.kpiValue explicitly
                    
                    return {
                        value: item,
                        symbol: path ? path : 'circle',
                        symbolSize: path ? [sizeX, sizeY] : 10,
                        symbolRotate: r,
                        itemStyle: {
                            color: item.color || 'rgba(100, 100, 200, 0.8)', // Pass color from parent
                            borderColor: 'rgba(255, 255, 255, 0.2)',
                            borderWidth: 1
                        },
                        kpiValue: item.kpiValue // Passed dynamically
                    };
                }),
                animation: false
            }]
        };

        chartInstance.current.setOption(option, true);

        const handleResize = () => {
            if (chartInstance.current) {
                chartInstance.current.resize();
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);

    }, [data, selectedKPI, title]);

    return <div ref={chartRef} style={{ width: '100%', height: '600px' }} />;
};

export default ScatterHeatmap;
