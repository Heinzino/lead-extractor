"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/supabaseClient';
import type { Database } from '@/types/supabase'; 
import Results from '@/components/Results';
import BusinessFinder from '@/components/BusinessFinder';
import ContactFinder from '@/components/ContactFinder';
import Settings from '@/components/Settings';
import Sidebar from '@/components/Sidebar';

type TestRow = Database['public']['Tables']['test']['Row'];

export default function Home() {
  const [data, setData] = useState<TestRow[]>([]);
  const [activePage, setActivePage] = useState<string>('Results');

  const renderActivePage = () => {
    switch (activePage) {
      case 'Results':
        return <Results />;
      case 'Business Finder':
        return <BusinessFinder />;
      case 'Contact Finder':
        return <ContactFinder />;
      case 'Settings':
        return <Settings />;
      default:
        return <Results />;
    }
  };

  useEffect(() => {
    const fetchTestData = async () => {
      const { data, error } = await supabase
        .from('test')
        .select('*');
      if (error) console.error('Error fetching data:', error);
      else setData(data);
    };

    fetchTestData();
  }, []);

  console.log('data', data)

  return (
    <div className="flex h-screen">
      <Sidebar setActivePage={setActivePage} />
      <div className="flex-1 p-8 bg-white overflow-y-auto">
        {renderActivePage()}
      </div>
    </div>
  );
}
