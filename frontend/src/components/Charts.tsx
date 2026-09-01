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

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444', '#64748B'];

export function Charts({ stats, cases }: ChartsProps) {
  const revenueData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "Recovered", value: stats.revenue_recovered },
      { name: "At Risk", value: stats.revenue_at_risk },
    ];
  }, [stats]);

  const unifiedStatusData = useMemo(() => {
    let recovering = 0;
    let paymentFailed = 0;
    let recovered = 0;
    let abandoned = 0;

    cases.forEach((curr) => {
      if (curr.status === "recovered" || curr.last_payment_status === "SUCCESS") {
        recovered++;
      } else if (curr.status === "abandoned") {
        abandoned++;
      } else if (curr.last_payment_status === "FAILED") {
        paymentFailed++;
      } else if (curr.status === "recovering") {
        recovering++;
      }
    });

    return [
      { name: "Recovering", value: recovering },
      { name: "Payment Failed", value: paymentFailed },
      { name: "Recovered", value: recovered },
      { name: "Abandoned", value: abandoned },
    ];
  }, [cases]);

  const failureData = useMemo(() => {
    const counts = cases.reduce((acc, curr) => {
      const reason = curr.failure_reason || "unknown";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts).map(([name, value]) => ({ name: title(name), value })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [cases]);

  return (
    <div className="charts-grid">
      <div className="chart-card">
        <div className="chart-header">
          <p className="eyebrow">Financial Impact</p>
          <h3>Revenue Recovered vs At Risk</h3>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={revenueData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                {revenueData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <RechartsTooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="chart-card">
        <div className="chart-header">
          <p className="eyebrow">Case Volume</p>
          <h3>Recovery Status</h3>
          <p className="chart-desc" style={{ fontSize: '13px', color: '#71717A', marginTop: '4px' }}>Overview of the current recovery and payment outcomes.</p>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={unifiedStatusData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
              <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#71717A' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#F4F4F5' }} />
              <Bar dataKey="value" fill="var(--color-accent)" radius={[4, 4, 0, 0]} minPointSize={3} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-header">
          <p className="eyebrow">Failure Analysis</p>
          <h3>Top Failure Reasons</h3>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={failureData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4E4E7" />
              <XAxis type="number" tick={{ fontSize: 12, fill: '#71717A' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} />
              <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#F4F4F5' }} />
              <Bar dataKey="value" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
