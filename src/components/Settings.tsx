import { useAuth } from '../context/AuthContext';

export default function Settings() {
  const { user } = useAuth();

  return (
    <div className="w-full mx-auto p-4 md:px-6 md:pt-4 md:pb-24">
      <div className="space-y-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">Settings</h2>

        {/* Account Information Section */}
        <div className="bg-white shadow-md rounded-2xl p-6 space-y-4">
          <h3 className="text-xl font-semibold text-gray-800">Account Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600">First Name</label>
              <div className="mt-1 text-gray-900">{
                // user?.first_name || 
                '—'}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">Last Name</label>
              <div className="mt-1 text-gray-900">{
              // user?.last_name || 
              '—'}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">Email</label>
              <div className="mt-1 text-gray-900">{user?.email || '—'}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600">Tokens Used</label>
              <div className="mt-1 text-gray-900">{
              // user?.tokens_used ?? 
              '—'}</div>
            </div>
          </div>
        </div>

        {/* Purchase Tokens Section */}
        <div className="bg-white shadow-md rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-gray-800">Purchase Tokens</h3>
        </div>
      </div>
    </div>
  );
}
