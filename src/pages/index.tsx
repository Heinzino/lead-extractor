"use client";
import { useState, useEffect } from 'react';
import Results from '../components/Results';
import BusinessFinder from '../components/BusinessFinder';
import ContactFinder from '../components/ContactFinder';
import Settings from '../components/Settings';
import Sidebar from '../components/Sidebar';
import { useRouter } from 'next/router';

export default function Home() {
  const [activePage, setActivePage] = useState<string>('Results');
  const router = useRouter();

  useEffect(() => {
    if (router && router.query) {
      const { payment_intent, redirect_status } = router.query;
      if (payment_intent && redirect_status === 'succeeded') {
        setActivePage('Settings');
      }
    }
  }, [router]);

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

  return (
    <div className="flex h-screen">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />
      <div className="flex-1 p-8 bg-white overflow-y-auto">
        {renderActivePage()}
      </div>
    </div>
  );
}
