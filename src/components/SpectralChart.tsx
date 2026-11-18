import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface SpectralChartProps {
  data: { index: number; value: number; baseline?: number }[];
}

export function SpectralChart({ data }: SpectralChartProps) {
  return (
    <div className="w-full h-48 md:h-64 mt-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800/50">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="index" stroke="#475569" tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis stroke="#475569" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f1f5f9' }}
            itemStyle={{ color: '#22d3ee' }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="#22d3ee" 
            strokeWidth={1.5} 
            dot={false} 
            activeDot={{ r: 4, fill: '#22d3ee', stroke: '#0f172a' }}
            isAnimationActive={false}
          />
          {data[0]?.baseline !== undefined && (
             <Line 
               type="monotone" 
               dataKey="baseline" 
               stroke="#64748b" 
               strokeWidth={1} 
               strokeDasharray="4 4"
               dot={false} 
               isAnimationActive={false}
             />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
