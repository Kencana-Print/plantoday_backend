import { describe, it, expect } from "vitest";
const {
    tentukanTierMargin,
    hitungKomponenBahan,
    hitungBiayaKonveksi,
    bulatkanHargaUp,
    kalkulasiGarmenEngine,
} = require("../utils/kalkulasiGarmenHelper");

describe("Unit Test: Logika Kalkulasi Garmen PlanToday (Murni / Tanpa DB)", () => {
    describe("1. Pengujian Tangga Tier Margin Kuantitas", () => {
        it("harus memilih Tier 1 (20%) untuk pesanan kecil di bawah 100 pcs", () => {
            const tier = tentukanTierMargin(50);
            expect(tier.tier).toBe(1);
            expect(tier.persen).toBe(20);
        });

        it("harus memilih Tier 1 (20%) untuk rentang 100 - 249 pcs", () => {
            const tier = tentukanTierMargin(150);
            expect(tier.tier).toBe(1);
            expect(tier.persen).toBe(20);
        });

        it("harus memilih Tier 2 (15%) untuk rentang 250 - 499 pcs", () => {
            const tier = tentukanTierMargin(300);
            expect(tier.tier).toBe(2);
            expect(tier.persen).toBe(15);
        });

        it("harus memilih Tier 3 (12.5%) untuk rentang 500 - 749 pcs", () => {
            const tier = tentukanTierMargin(600);
            expect(tier.tier).toBe(3);
            expect(tier.persen).toBe(12.5);
        });

        it("harus memilih Tier 4 (10%) untuk rentang 750 - 999 pcs", () => {
            const tier = tentukanTierMargin(850);
            expect(tier.tier).toBe(4);
            expect(tier.persen).toBe(10);
        });

        it("harus memilih Tier 5 (7%) untuk pesanan besar >= 1000 pcs", () => {
            const tier = tentukanTierMargin(1500);
            expect(tier.tier).toBe(5);
            expect(tier.persen).toBe(7);
        });
    });

    describe("2. Pengujian Pembulatan Harga UP (Kelipatan 1000 ke Atas)", () => {
        it("harus membulatkan ke atas jika ada kelebihan rupiah", () => {
            expect(bulatkanHargaUp(45100)).toBe(46000);
            expect(bulatkanHargaUp(45001)).toBe(46000);
            expect(bulatkanHargaUp(45999)).toBe(46000);
        });

        it("harus tetap sama jika sudah pas kelipatan 1000", () => {
            expect(bulatkanHargaUp(45000)).toBe(45000);
            expect(bulatkanHargaUp(50000)).toBe(50000);
        });
    });

    describe("3. Pengujian Biaya Konveksi (Jahit)", () => {
        it("harus menggunakan tarif standar Rp 5.610 untuk katun", () => {
            const biaya = hitungBiayaKonveksi({ isSport: false });
            expect(biaya).toBe(5610);
        });

        it("harus menggunakan tarif sport Rp 2.800 untuk bahan jersey/sport", () => {
            const biaya = hitungBiayaKonveksi({ isSport: true });
            expect(biaya).toBe(2800);
        });

        it("harus mendukung custom biaya jahit jika ditentukan", () => {
            const biaya = hitungBiayaKonveksi({
                isSport: false,
                customBiayaJahit: 6500,
            });
            expect(biaya).toBe(6500);
        });
    });

    describe("4. Pengujian Komponen Bahan & Model (KH-0001 vs KH-0002)", () => {
        it("Kaos Oblong (KH-0001) tidak boleh memperhitungkan biaya lengan terpisah", () => {
            const bahan = hitungKomponenBahan({
                kodeModel: "KH-0001",
                hargaBahan: 130000,
                bBody: 4.2,
                bLengan: 7,
                bRib: 70,
                allowancePersen: 17,
            });

            expect(bahan.hargaBody).toBeGreaterThan(0);
            expect(bahan.hargaLengan).toBe(0); // Kaos oblong lengan menyatu di body
            expect(bahan.hargaRib).toBeGreaterThan(0);
            expect(bahan.allowancePersen).toBe(17);
            expect(bahan.totalBahan).toBeGreaterThan(bahan.totalHargaBahan);
        });

        it("Polo/Raglan (KH-0002) harus menghitung biaya lengan terpisah", () => {
            const bahan = hitungKomponenBahan({
                kodeModel: "KH-0002",
                hargaBahan: 130000,
                bBody: 4.2,
                bLengan: 7,
                bRib: 70,
                allowancePersen: 17,
            });

            expect(bahan.hargaBody).toBeGreaterThan(0);
            expect(bahan.hargaLengan).toBeGreaterThan(0); // Lengan terpisah dihitung
            expect(bahan.totalHargaBahan).toBeGreaterThan(
                bahan.hargaBody + bahan.hargaRib,
            );
        });
    });

    describe("5. Pengujian Engine Kalkulasi End-to-End Tanpa DB", () => {
        it("harus menghasilkan HPP, Margin, dan Harga UP dengan tepat", () => {
            const res = kalkulasiGarmenEngine({
                kodeModel: "KH-0001",
                hargaBahan: 130000,
                bBody: 4.2,
                bLengan: 0,
                bRib: 70,
                allowancePersen: 17,
                isSport: false,
                qty: 150,
                totalTambahanPerPcs: 12000, // Sablon
            });

            expect(res.hpp).toBeGreaterThan(25000);
            expect(res.strataAktif.tier).toBe(1);
            expect(res.strataAktif.persen).toBe(20);
            expect(res.hargaJualPerPcs).toBe(
                res.hpp + res.strataAktif.marginRp + 12000,
            );
            expect(res.hargaUpPerPcs).toBe(
                bulatkanHargaUp(res.hargaJualPerPcs),
            );
            expect(res.totalHargaOrder).toBe(res.hargaUpPerPcs * 150);
            expect(res.tabelReferensi).toHaveLength(5);
        });
    });

    it("harus menghitung biaya tambahan (x qty order) dan cetak (x custom qty) secara akurat", () => {
        const res = kalkulasiGarmenEngine({
            kodeModel: "KH-0001",
            hargaBahan: 130000,
            bBody: 4.2,
            bLengan: 0,
            bRib: 70,
            allowancePersen: 17,
            isSport: false,
            qty: 100, // Rencana order 100 pcs
            tambahanList: [
                { ket: "KRAH BIASA", tarif: 5000 }, // 5000 x 100 = 500.000 (Rp 5.000/pcs)
            ],
            cetakList: [
                { jenis: "CETAK", ket: "SABLON A3", biaya: 10000, customQty: 50 }, // 10000 x 50 = 500.000 (Rp 5.000/pcs)
            ],
        });

        expect(res.tambahan.totalOrder).toBe(500000);
        expect(res.tambahan.totalPerPcs).toBe(5000);
        expect(res.cetak.totalOrder).toBe(500000);
        expect(res.cetak.totalPerPcs).toBe(5000);
        // Total tambahan + cetak per pcs = 10.000
        expect(res.hargaJualPerPcs).toBe(res.hpp + res.strataAktif.marginRp + 10000);
    });
});
