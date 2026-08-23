// The chemical products Arcadian actually applies, each carrying its own
// active constituent.
//
// WHY THIS IS A LIST AND NOT A TEXT BOX
// The active constituent and its concentration are a legal particular of a
// pesticide-use record (NSW Pesticides Regulation 2017 cl 36). Asking a
// technician to type "Beta-cyfluthrin 25g/L & Imidacloprid 50g/L" on a phone,
// at a job, is asking for a transcription error on a document that has to
// stand up years later. Picking "Temprid 75" and having the chemistry come
// with it is both faster and correct by construction.
//
// Ported from the product list Arcadian has been using in the field, so the
// names match what is already on the shelf and in past records.
//
// APVMA numbers are deliberately absent rather than guessed: a wrong
// registration number on a compliance document is worse than a blank one.
// Fill them in as they're confirmed from the label — `apvma` is optional and
// the report simply omits what isn't known.
(() => {
  'use strict';

  const PEST_PRODUCTS = [
    { name: 'Abide Termite Bait', active: 'Chlorfluazuron 1.0 g/kg', form: 'bait' },
    { name: 'Advion Ant Gel', active: 'Indoxacarb 0.5 g/kg', form: 'gel' },
    { name: 'Advion Cockroach Gel AEPMA', active: 'Indoxacarb 6 g/kg', form: 'gel' },
    { name: 'Antagonist Pro', active: 'Bifenthrin 80 g/L', form: 'concentrate' },
    { name: 'Attrathor', active: 'Fipronil 26 g/L', form: 'concentrate' },
    { name: 'Battleaxe Pro Crack & Crevice Aerosol', active: 'Propoxur 20 g/kg, Tetramethrin 2 g/kg, Piperonyl Butoxide 10 g/kg', form: 'aerosol' },
    { name: 'Battleaxe Pro Roach Bait', active: 'Fipronil 0.5 g/kg', form: 'bait' },
    { name: 'Biflex Aqua Max', active: 'Bifenthrin 100 g/L', form: 'concentrate' },
    { name: 'Biflex Ultra', active: 'Bifenthrin 100 g/L', form: 'concentrate' },
    { name: 'Chainrite', active: 'Permethrin 25:75 10 g/kg', form: 'dust' },
    { name: 'Cislin 25', active: 'Deltamethrin 25 g/L', form: 'concentrate' },
    { name: 'Clear-Out Crawling Insect Aerosol', active: 'Fipronil 0.6 g/kg', form: 'aerosol' },
    { name: 'Contrac Blox', active: 'Bromadiolone 0.05 g/kg', form: 'rodenticide' },
    { name: 'Coopex Dusting Powder', active: 'Permethrin 25:75 250 g/kg', form: 'dust' },
    { name: 'Country 10 Deltamethrin', active: 'Deltamethrin 10 g/L', form: 'concentrate' },
    { name: 'Deltathor Insecticide', active: 'Deltamethrin 10 g/L', form: 'concentrate' },
    { name: 'Ditrac All Weather Blox', active: 'Bromadiolone 0.05 g/kg', form: 'rodenticide' },
    { name: 'Fipforce Aqua', active: 'Fipronil 100 g/L', form: 'concentrate' },
    { name: 'Generation First Strike Soft Baits', active: 'Difethialone 0.025 g/kg', form: 'rodenticide' },
    { name: 'Goliath Cockroach Gel', active: 'Fipronil 0.5 g/kg', form: 'gel' },
    { name: 'Goliath Liquid Ant Bait', active: 'Fipronil 0.6 g/L', form: 'bait' },
    { name: 'Maxforce Gold Cockroach Gel', active: 'Fipronil 0.3 g/kg', form: 'gel' },
    { name: 'Maxforce Quantum Liquid Ant Bait', active: 'Imidacloprid 0.3 g/L', form: 'bait' },
    { name: 'Maxforce White Cockroach Gel', active: 'Imidacloprid 21.5 g/kg', form: 'gel' },
    { name: 'Maxxthor', active: 'Bifenthrin 100 g/L', form: 'concentrate' },
    { name: 'Nemesis Termite Bait', active: 'Chlorfluazuron 1.0 g/kg', form: 'bait' },
    { name: 'Sentricon Always Active', active: 'Hexaflumuron 5 g/kg', form: 'bait' },
    { name: 'Stardust Pro', active: 'Permethrin 40:60 20 g/kg, Triflumuron 5 g/kg', form: 'dust' },
    { name: 'Starycide Pro', active: 'Fipronil 0.25 g/kg', form: 'concentrate' },
    { name: 'Temprid 75', active: 'Beta-cyfluthrin 25 g/L, Imidacloprid 50 g/L', form: 'concentrate' },
    { name: 'Termatrix Termite Bait', active: 'Chlorfluazuron 1.0 g/kg', form: 'bait' },
    { name: 'Termidor Dry', active: 'Fipronil 5 g/kg', form: 'dust' },
    { name: 'Termidor Foam Termiticide & Insecticide', active: 'Fipronil 0.05 g/kg', form: 'foam' },
    { name: 'Termidor HE Residual Termiticide', active: 'Fipronil 96 g/L', form: 'concentrate' },
    { name: 'Terminade', active: 'Fipronil 100 g/L', form: 'concentrate' },
    { name: 'Ultrathor', active: 'Fipronil 100 g/L', form: 'concentrate' },
    { name: 'Wasp Freeze', active: 'd-Allethrin 1.3 g/kg, d-Phenothrin 1.2 g/kg', form: 'aerosol' },
    { name: 'Wasp Jet', active: 'Cyphenothrin 2.5 g/kg, d-Tetramethrin 2.5 g/kg', form: 'aerosol' },
  ];

  // Ready-to-use products are not diluted, so asking for a concentrate volume
  // is asking for a number that does not exist — and a field that cannot be
  // answered honestly is a field that gets left blank or invented. These forms
  // record an applied amount instead.
  const READY_TO_USE = new Set(['gel', 'bait', 'aerosol', 'rodenticide', 'dust', 'foam']);

  function isReadyToUse(productName) {
    const product = PEST_PRODUCTS.find((p) => p.name === productName);
    return !!product && READY_TO_USE.has(product.form);
  }

  function activeFor(productName) {
    const product = PEST_PRODUCTS.find((p) => p.name === productName);
    return product ? product.active : '';
  }

  // What the picklist shows: name and chemistry together, so the technician
  // can see at a glance that they've grabbed the right tin.
  function productLabel(product) {
    return `${product.name} (${product.active})`;
  }

  window.PEST_PRODUCTS = PEST_PRODUCTS;
  window.PestProducts = { isReadyToUse, activeFor, productLabel, READY_TO_USE };
})();
