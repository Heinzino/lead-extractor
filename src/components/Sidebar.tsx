import { useState } from 'react';
import { Search, Briefcase, Phone, Settings, ChevronsLeft, Menu } from 'lucide-react';

const sidebarItems = [
  { title: 'Results', icon: <Search size={24} /> },
  { title: 'Business Finder', icon: <Briefcase size={24} /> },
  { title: 'Contact Finder', icon: <Phone size={24} /> },
  { title: 'Settings', icon: <Settings size={24} /> },
];

export default function Sidebar({ activePage, setActivePage }: { activePage: string, setActivePage: (page: string) => void }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false); // Closed by default on mobile, open on desktop

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const handleNavigation = (page: string) => {
    setActivePage(page);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  return (
    <>
      <button
        className="md:hidden fixed top-4 left-4 z-50 bg-darkBlue p-2 rounded-lg shadow-lg"
        onClick={() => setIsSidebarOpen(true)}
        aria-label="Open Sidebar"
      >
        <Menu size={28} className="text-white" />
      </button>

      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-40 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div
        className={`
          fixed top-0 left-0 h-full z-50
          bg-darkBlue text-white
          transition-transform duration-300
          w-64 md:w-80
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:flex
        `}
      >
        <div className={`flex flex-col w-full p-6 h-full`}>
          <div className="flex items-center justify-between">
            <div className='flex items-center gap-4'>
              <img src="/Risorsa_7c.svg" alt="Logo" className="w-8 h-8" />
              <h1 className="text-2xl font-bold">Lead Extractor</h1>
            </div>
            <button
              onClick={toggleSidebar}
              className="text-white focus:outline-none hover:cursor-pointer md:hidden"
              aria-label="Close Sidebar"
            >
              <ChevronsLeft size={24} />
            </button>
          </div>

          <nav className="mt-8 flex flex-col space-y-4">
            {sidebarItems.map((item) => (
              <button
                key={item.title}
                onClick={() => handleNavigation(item.title)}
                className={`flex items-center space-x-4 p-3 rounded-lg hover:bg-gray-800 hover:text-sky-400 hover:cursor-pointer ${
                  activePage === item.title ? 'bg-gray-800 text-sky-400' : ''
                }`}
              >
                {item.icon}
                <span>{item.title}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
