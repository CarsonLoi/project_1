import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  CardContent,
  ToggleButton,
  ToggleButtonGroup,
  Box,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import * as echarts from 'echarts';
import dayjs from 'dayjs';
import SectionTitle from './SectionTitle';

const SEGMENTS = ['Mainstream', 'Premium Mass'];
const PITS = ['901', '902', '903', '801', '802', '701', '702'];
const GAMES = ['Baccarat', 'Sic Bo', 'Roulette', 'Craps'];
const TABLE_MINS = [500, 1000, 1500, 2000, 3000, 5000];
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function DemandSupplyChart() {
  const [viewMode, setViewMode] = useState('By Day By Hour');

  // Filters
  const [startDate, setStartDate] = useState(dayjs('2025-12-01'));
  const [endDate, setEndDate] = useState(dayjs('2025-12-31'));
  const [selectedSegment, setSelectedSegment] = useState([]);
  const [selectedPit, setSelectedPit] = useState([]);
  const [selectedGame, setSelectedGame] = useState([]);
  const [selectedDow, setSelectedDow] = useState([]);
  const [selectedTableMin, setSelectedTableMin] = useState([]); // ← New filter

  const chartRef = useRef(null);

  // Generate synthetic data with tablemin
  const generateData = () => {
    const data = [];
    const start = dayjs('2025-12-01');
    const end = dayjs('2025-12-31');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let d = start; d <= end; d = d.add(1, 'day')) {
      const dateStr = d.format('YYYY-MM-DD');
      const dow = dayNames[d.day()];

      for (let hour = 0; hour < 24; hour++) {
        const isPeak = hour >= 18 && hour <= 23;
        const isWeekend = dow === 'Sat' || dow === 'Sun';

        const base = 40 + Math.sin((hour + 6) / 24 * Math.PI) * 30;
        const demand = Math.round(
          base + (isPeak ? 80 : 0) + (isWeekend ? 50 : 0) + Math.random() * 25
        );

        const supply = Math.round(demand * (0.6 + Math.random() * 0.4));
        const capacity = 200 + Math.round(Math.random() * 40);

        data.push({
          date: dateStr,
          dow,
          hour,
          demand,
          supply,
          capacity,
          segment: SEGMENTS[Math.floor(Math.random() * SEGMENTS.length)],
          pit: PITS[Math.floor(Math.random() * PITS.length)],
          game: GAMES[Math.floor(Math.random() * GAMES.length)],
          tablemin: TABLE_MINS[Math.floor(Math.random() * TABLE_MINS.length)], // ← Added
        });
      }
    }
    return data;
  };

  const rawData = generateData();

  // Unique values for dropdowns
  const uniqueSegments = [...new Set(rawData.map(r => r.segment))].sort();
  const uniquePits = [...new Set(rawData.map(r => r.pit))].sort();
  const uniqueGames = [...new Set(rawData.map(r => r.game))].sort();

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);

    // Apply all filters
    let filtered = rawData.filter(row => {
      const dateInRange = dayjs(row.date).isAfter(startDate.subtract(1, 'day')) && dayjs(row.date).isBefore(endDate.add(1, 'day'));
      const segmentMatch = selectedSegment.length === 0 || selectedSegment.includes(row.segment);
      const pitMatch = selectedPit.length === 0 || selectedPit.includes(row.pit);
      const gameMatch = selectedGame.length === 0 || selectedGame.includes(row.game);
      const dowMatch = selectedDow.length === 0 || selectedDow.includes(row.dow);
      const tableMinMatch = selectedTableMin.length === 0 || selectedTableMin.includes(row.tablemin);

      return dateInRange && segmentMatch && pitMatch && gameMatch && dowMatch && tableMinMatch;
    });

    // Hour order: start from 6 AM → 5 AM next day
    const hourOrder = [...Array(24).keys()].slice(6).concat([...Array(6).keys()]); // [6,7,...,23,0,1,2,3,4,5]

    // Aggregation logic (same as before, but using hourOrder)
    const aggMap = {};
    filtered.forEach(row => {
      let groupKey, hourKey;
      if (viewMode === 'By Day By Hour') {
        groupKey = row.date;
        hourKey = row.hour;
      } else if (viewMode === 'By Day of Week By Hour') {
        groupKey = row.dow;
        hourKey = row.hour;
      } else {
        groupKey = 'All';
        hourKey = row.hour;
      }

      const key = `${groupKey}|${hourKey}`;
      if (!aggMap[key]) aggMap[key] = { demand: 0, supply: 0, capacity: 0, count: 0 };
      aggMap[key].demand += row.demand;
      aggMap[key].supply += row.supply;
      aggMap[key].capacity += row.capacity;
      aggMap[key].count += 1;
    });

    // Build ordered data using hourOrder
    let groups = viewMode === 'By Hour' ? ['All'] : 
      viewMode === 'By Day By Hour' ? [...new Set(filtered.map(r => r.date))].sort() :
      DAY_ORDER.filter(d => filtered.some(r => r.dow === d));

    let demand = [];
    let supply = [];
    let capacity = [];
    let xAxisData = [];
    let xAxisGroupData = [];
    let groupSeparates = [];

    groups.forEach(group => {
      hourOrder.forEach(h => {
        const key = `${group}|${h}`;
        const item = aggMap[key] || { demand: 0, supply: 0, capacity: 0, count: 1 };
        demand.push(Math.round(item.demand / item.count));
        supply.push(Math.round(item.supply / item.count));
        capacity.push(Math.round(item.capacity / item.count));

        xAxisData.push(h.toString());

        const isMiddle = h === 18; // 6 PM is roughly middle of 6AM–5AM cycle
        const labelText = isMiddle ?
          (viewMode === 'By Day By Hour' ? dayjs(group).format('MMM DD') : group) : '';
        xAxisGroupData.push(isMiddle ? `{offset|${labelText}}` : '');

        groupSeparates.push(h === 6); // Separator at start of each group (6 AM)
      });
    });

    // dynamic y-axis scale
    const allValues = [...demand, ...supply, ...capacity];
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100; // fallback if no data
    const yMax = Math.ceil(dataMax * 1.1);
    const format_yMax = Math.ceil(yMax / 10) * 10;   // e.g. 112 → 120, 47 → 50

    const option = {
      title: {
        text: 'Demand vs Supply vs Capacity',
        left: 'left',
        left: 20,               // ← distance from left edge (adjust 10–30 px as needed)
        top: 10,                // small top padding
        textStyle: { color: '#e0e0e0', fontSize: 18 },
        show: false
      },
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['Demand', 'Supply', 'Capacity'],
        top: 10,
        textStyle: { color: '#a0a0a0' },
      },
      grid: {
        left: 60,
        right: 40,
        top: '2%',
        bottom: 80,
        containLabel: false,
      },
      xAxis: [
        {
          type: 'category',
          data: xAxisData,
          position: 'bottom',
          axisTick: { length: 0 },
          axisLabel: {
            margin: 10,
            color: '#a0a0a0',
            fontSize: 12,
          },
        },
        {
          type: 'category',
          data: xAxisGroupData,
          position: 'bottom',
          axisLine: { onZero: false }, // new
          axisTick: {
            show: true,
            length: 50,
            interval: (index) => groupSeparates[index],
            lineStyle: { color: '#444', width: 1 },
          },
          axisLabel: {
            margin: 50, // ← increase this → brings date closer to hours
            align: 'center',              // ← very important for centering
            verticalAlign: 'top',
            interval: 0,
            rich: { offset: { width: 80 } },
            formatter: (value) => value.trim() ? value : '', // clean empty strings
            color: '#e0e0e0',
            fontSize: 13,
            fontWeight: 'bold',
          },
        },
      ],
      yAxis: {
        type: 'value',
        max: format_yMax,
        axisLabel: { color: '#a0a0a0' },
        splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
      },
      series: [
        { name: 'Demand', type: 'line', areaStyle: { opacity: 0.6 }, lineStyle: { width: 3 }, itemStyle: { color: '#ef4444' }, data: demand, smooth: true },
        { name: 'Supply', type: 'line', lineStyle: { width: 3 }, itemStyle: { color: '#3b82f6' }, data: supply, smooth: true },
        { name: 'Capacity', type: 'line', lineStyle: { width: 3 }, itemStyle: { color: '#1e293b' }, data: capacity, smooth: true },
      ],
      dataZoom: [
        { type: 'slider', start: 0, end: 100, bottom: 20, height: 20, show: false },
        { type: 'inside' },
      ],
    };

    chart.setOption(option, true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
    };
  }, [viewMode, rawData, startDate, endDate, selectedSegment, selectedPit, selectedGame, selectedDow, selectedTableMin]);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Card sx={{ width: '100%', p: 2, mb: 3, bgcolor: '#1e1e28' }}>
        {/* First Row: Title + Toggle */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <SectionTitle title="Demand vs Supply vs Capacity" />
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, v) => v && setViewMode(v)}
            size="small"
            sx={{
              bgcolor: '#2c2c35',
              '& .MuiToggleButton-root': {
                color: '#a0a0a0',
                border: 'none',
                '&.Mui-selected': { color: '#2979ff', bgcolor: 'rgba(41, 121, 255, 0.15)' },
              },
            }}
          >
            <ToggleButton value="By Day By Hour">By Day By Hour</ToggleButton>
            <ToggleButton value="By Day of Week By Hour">By DOW By Hour</ToggleButton>
            <ToggleButton value="By Hour">By Hour</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <CardContent sx={{ pt: 0, px: 0 }}>
          <Grid container spacing={1}>
            <Grid size={{ xs: 12, md: 2 }}>
              <Stack spacing={2}>

                <DatePicker
                  label="Start Date"
                  value={startDate}
                  onChange={setStartDate}
                  slotProps={{ textField: { size: 'small' } }}
                />

                <DatePicker
                  label="End Date"
                  value={endDate}
                  onChange={setEndDate}
                  slotProps={{ textField: { size: 'small' } }}
                />

                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Segment</InputLabel>
                  <Select multiple value={selectedSegment} onChange={(e) => setSelectedSegment(e.target.value)}>
                    {uniqueSegments.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Pit</InputLabel>
                  <Select multiple value={selectedPit} onChange={(e) => setSelectedPit(e.target.value)}>
                    {uniquePits.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Game</InputLabel>
                  <Select multiple value={selectedGame} onChange={(e) => setSelectedGame(e.target.value)}>
                    {uniqueGames.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Day of Week</InputLabel>
                  <Select multiple value={selectedDow} onChange={(e) => setSelectedDow(e.target.value)}>
                    {DAY_ORDER.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                  </Select>
                </FormControl>

                {/* New Table Min filter */}
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Table Min</InputLabel>
                  <Select multiple value={selectedTableMin} onChange={(e) => setSelectedTableMin(e.target.value)}>
                    {TABLE_MINS.map(tm => <MenuItem key={tm} value={tm}>{tm.toLocaleString()}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
            </Grid>

            <Grid size={{ xs: 12, md: 10 }}>
              <div ref={chartRef} style={{ width: '100%', height: 500 }} />
            </Grid>

          </Grid>
        </CardContent>
      </Card>
    </LocalizationProvider>
  );
}