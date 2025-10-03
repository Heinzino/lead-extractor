'use client';

import { useMemo, useState, useCallback } from 'react';
import Select, { SingleValue } from 'react-select';
import { Country, State, City, type ICountry, type IState, type ICity } from 'country-state-city';

type Option<T> = { value: string; label: string; raw: T };

export default function LocationPicker({
                                           onChange,
                                           className,
                                           placeholderCountry = 'Select country',
                                           placeholderState = 'Select state (optional)',
                                           placeholderCity = 'Select city (optional)',
                                       }: {
    onChange: (loc: string) => void; // 'US' | 'US:CA' | 'US:CA:San Francisco' | ''
    className?: string;
    placeholderCountry?: string;
    placeholderState?: string;
    placeholderCity?: string;
}) {
    const [country, setCountry] = useState<ICountry | null>(null);
    const [state, setState]     = useState<IState | null>(null);
    const [city, setCity]       = useState<ICity | null>(null);

    const countries: Option<ICountry>[] = useMemo(
        () => Country.getAllCountries().map(c => ({ value: c.isoCode, label: c.name, raw: c })),
        []
    );

    const states: Option<IState>[] = useMemo(
        () =>
            country
                ? State.getStatesOfCountry(country.isoCode).map(s => ({ value: s.isoCode, label: s.name, raw: s }))
                : [],
        [country]
    );

    const cities: Option<ICity>[] = useMemo(
        () =>
            country && state
                ? City.getCitiesOfState(country.isoCode, state.isoCode).map(ct => ({ value: ct.name, label: ct.name, raw: ct }))
                : [],
        [country, state]
    );

    const emit = useCallback((c: ICountry | null, s: IState | null, ct: ICity | null) => {
        if (!c) { onChange(''); return; }
        let str = c.isoCode;            // e.g. 'US'
        if (s)  str += `:${s.isoCode}`; // e.g. 'US:CA'
        if (ct) str += `:${ct.name}`;   // e.g. 'US:CA:San Francisco'
        onChange(str);
    }, [onChange]);

    return (
        <div className={className}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {/* Country */}
                <Select<Option<ICountry>, false>
                    options={countries}
                    value={country ? { value: country.isoCode, label: country.name, raw: country } : null}
                    onChange={(opt: SingleValue<Option<ICountry>>) => {
                        const c = opt ? (Country.getCountryByCode(opt.value) ?? null) : null;
                        setCountry(c);          // now ICountry | null (never undefined)
                        setState(null);
                        setCity(null);
                        emit(c, null, null);
                    }}
                    isClearable
                    placeholder={placeholderCountry}
                />

                {/* State (optional) */}
                <Select<Option<IState>, false>
                    options={states}
                    value={state ? { value: state.isoCode, label: state.name, raw: state } : null}
                    onChange={(opt: SingleValue<Option<IState>>) => {
                        const s = opt && country ? (State.getStateByCodeAndCountry(opt.value, country.isoCode) ?? null) : null;
                        setState(s);            // IState | null
                        setCity(null);
                        emit(country, s, null);
                    }}
                    isClearable
                    isDisabled={!country}
                    placeholder={placeholderState}
                />

                {/* City (optional) */}
                <Select<Option<ICity>, false>
                    options={cities}
                    value={city ? { value: city.name, label: city.name, raw: city } : null}
                    onChange={(opt: SingleValue<Option<ICity>>) => {
                        const ct = opt ? (opt.raw ?? null) : null; // raw is already ICity, but keep it tidy
                        setCity(ct);             // ICity | null
                        emit(country, state, ct);
                    }}
                    isClearable
                    isDisabled={!country || !state}
                    placeholder={placeholderCity}
                />
            </div>
        </div>
    );
}