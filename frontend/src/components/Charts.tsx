import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { DashboardStats, RecoveryCase, formatINR, title } from '../types';

interface ChartsProps {
  stats: DashboardStats | null;
  cases: RecoveryCase[];
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <div className="label">{payload[0].name}</div>
        <div className="desc">{typeof payload[0].value === 'number' && payload[0].value > 1000 ? formatINR(payload[0].value) : payload[0].value}</div>
      </div>
    );
  }
  return null;
};

const REVENUE_COLORS = ['#16A34A', '#D97706'];

export function Charts({ stats, cases }: ChartsProps) {
  const revenueData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "Recovered", value: stats.revenue_recovered },
      { name: "At Risk", value: stats.revenue_at_risk },
    ];
  }, [stats]);

  const activeRevenueSlices = useMemo(() => {
    return revenueData.filter(d => d.value > 0);
  }, [revenueData]);

  const hasRevenueData = Boolean(
    stats && ((stats.revenue_recovered || 0) + (stats.revenue_at_risk || 0)) > 0
  );

  const unifiedStatusData = useMemo(() => {
    let recovering = 0;
    let recovered = 0;
    let humanReview = 0;
    let abandoned = 0;

    cases.forEach((curr) => {
      if (curr.status === "recovered") {
        recovered++;
      } else if (curr.status === "abandoned" || curr.status === "closed") {
        abandoned++;
      } else if (curr.status === "human_review") {
        humanReview++;
      } else if (curr.status === "recovering") {
        recovering++;
      }
    });

    return [
      { name: "Recovering", value: recovering },
      { name: "Recovered", value: recovered },
      { name: "Human Review", value: humanReview },
      { name: "Abandoned", value: abandoned },
    ];
  }, [cases]);

  const hasStatusData = cases.length > 0;

  const failureData = useMemo(() => {
    const counts = cases.reduce((acc, curr) => {
      const reason = curr.failure_reason || "unknown";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts).map(([name, value]) => ({ name: title(name), value })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [cases]);

  const hasFailureData = failureData.length > 0 && failureData.some(d => d.value > 0);

  return (
    <div className="charts-grid">
      <div className="chart-card">
        <div className="chart-header">
          <p className="eyebrow">Financial Impact</p>
          <h3>Revenue Recovered vs At Risk</h3>
          <p className="chart-desc">Recovered value against pending recovery volume</p>
        </div>
        <div className="chart-container">
          {!stats ? (
            <div className="chart-empty-state chart-loading-state">
              <span className="spinner" style={{ marginRight: 8 }} />
              <span>Loading financial metrics...</span>
            </div>
          ) : !hasRevenueData || activeRevenueSlices.length === 0 ? (
            <div className="chart-empty-state">
              <span>No recovery revenue data recorded yet.</span>
            </div>
          ) : (
            <div>
              <ResponsiveContainer width="100%" height={190} minWidth={0}>
                <PieChart>
                  <Pie data={activeRevenueSlices} cx="50%" cy="50%" innerRadius={52} outerRadius={76} paddingAngle={3} dataKey="value">
                    {activeRevenueSlices.map((item, index) => (
                      <Cell key={`cell-${index}`} fill={item.name === 'Recovered' ? '#16A34A' : '#D97706'} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 4, fontSize: '11px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#667085', fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />
                  Recovered ({formatINR(stats.revenue_recovered)})
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#667085', fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D97706' }} />
                  At Risk ({formatINR(stats.revenue_at_risk)})
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="chart-card">
        <div className="chart-header">
          <p className="eyebrow">Case Volume</p>
          <h3>Recovery Status</h3>
          <p className="chart-desc">Overview of active recovery lifecycle distribution</p>
        </div>
        <div className="chart-container">
          {!hasStatusData ? (
            <div className="chart-empty-state">
              <span>No cases available.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <BarChart data={unifiedStatusData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E9EE" />
                <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#F8FAFC' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {unifiedStatusData.map((entry, index) => {
                    const color = entry.name === 'Recovered' ? '#16A34A' :
                                  entry.name === 'Human Review' ? '#D97706' :
                                  entry.name === 'Abandoned' ? '#667085' : '#2563EB';
                    return <Cell key={`status-cell-${index}`} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <p className="eyebrow">Failure Analysis</p>
          <h3>Top Failure Reasons</h3>
          <p className="chart-desc">Primary reasons for initial transaction decline</p>
        </div>
        <div className="chart-container">
          {!hasFailureData ? (
            <div className="chart-empty-state">
              <span>No transaction failure reasons recorded.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <BarChart data={failureData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E7E9EE" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#F8FAFC' }} />
                <Bar dataKey="value" fill="#2563EB" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
